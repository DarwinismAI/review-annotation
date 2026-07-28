import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL ?? "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const BUCKET = "uploads";

export async function uploadFile(path: string, data: Buffer | Uint8Array, contentType: string) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, data, { contentType, upsert: true });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return path;
}

export function getPublicUrl(path: string): string {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function getSignedUrl(path: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresIn);

  if (error) throw new Error(`Signed URL failed: ${error.message}`);
  return data.signedUrl;
}

/**
 * Generate a one-shot signed upload URL the browser can PUT directly to.
 * Bypasses Vercel's 4.5MB serverless body limit for large ZIP uploads.
 */
export async function createSignedUploadUrl(path: string): Promise<{
  signedUrl: string;
  token: string;
  path: string;
}> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);

  if (error) throw new Error(`Signed upload URL failed: ${error.message}`);
  return { signedUrl: data.signedUrl, token: data.token, path: data.path };
}

/** Download a previously-uploaded object as a Buffer (server-side only). */
export async function downloadFile(path: string): Promise<Buffer> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Storage download failed: ${error?.message ?? "no data"}`);
  const arrayBuf = await data.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/**
 * Recursively delete every object under a folder prefix (e.g. `{batchId}/`).
 * Swallows "not found" errors so this is safe to call on a half-clean folder.
 */
export async function deleteFolder(prefix: string): Promise<void> {
  async function listAll(path: string): Promise<string[]> {
    const { data, error } = await supabase.storage.from(BUCKET).list(path, { limit: 1000 });
    if (error) throw new Error(`Storage list failed: ${error.message}`);
    const keys: string[] = [];
    for (const entry of data ?? []) {
      const childPath = path ? `${path}/${entry.name}` : entry.name;
      // Supabase signals "this is a folder" by returning id=null.
      if (entry.id === null) {
        keys.push(...(await listAll(childPath)));
      } else {
        keys.push(childPath);
      }
    }
    return keys;
  }

  const keys = await listAll(prefix.replace(/\/$/, ""));
  if (keys.length === 0) return;
  const { error } = await supabase.storage.from(BUCKET).remove(keys);
  if (error) throw new Error(`Storage remove failed: ${error.message}`);
}

export { BUCKET };
