/**
 * Import zip chunks of JSON articles through Supabase REST + Storage.
 *
 * Use when DATABASE_URL is unavailable but a server-side Supabase key exists.
 * Idempotent by batch name.
 */
import { createClient } from "@supabase/supabase-js";
import { createId } from "@paralleldrive/cuid2";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { DomainKey } from "../src/lib/labels";

type Domain = DomainKey;

interface ManifestItem {
  file: string;
  name: string;
  domain: Domain;
  count?: number;
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SECRET_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const manifestPath = process.argv[2];
const adminEmail = process.env.ADMIN_EMAIL ?? "admin@review-annotation.local";

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY are required");
}
if (!manifestPath) {
  throw new Error("Usage: tsx scripts/import-json-chunks-rest.ts <manifest.json>");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function getAdminId(): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,role")
    .eq("email", adminEmail)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Admin profile not found: ${adminEmail}`);
  return data.id;
}

async function batchExists(name: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("batches")
    .select("id")
    .eq("name", name)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function uploadObject(key: string, body: Buffer, contentType: string) {
  const { error } = await supabase.storage
    .from("uploads")
    .upload(key, body, { contentType, upsert: true });
  if (error) throw new Error(`Storage upload failed for ${key}: ${error.message}`);
}

async function importChunk(item: ManifestItem, adminId: string) {
  if (await batchExists(item.name)) {
    console.log(`skip existing: ${item.name}`);
    return { skipped: true, articles: 0 };
  }

  const zipPath = resolve(item.file);
  const zipBuffer = await readFile(zipPath);
  const zip = await JSZip.loadAsync(zipBuffer);
  const jsonEntries = Object.entries(zip.files).filter(
    ([name, entry]) => !entry.dir && name.toLowerCase().endsWith(".json")
  );
  if (jsonEntries.length === 0) {
    console.log(`skip empty: ${item.name}`);
    return { skipped: true, articles: 0 };
  }

  const batchId = createId();
  const now = Date.now();
  const filename = basename(zipPath);
  const canonicalSourceKey = `${batchId}/${filename}`;
  await uploadObject(canonicalSourceKey, zipBuffer, "application/zip");

  const articleRows = [];
  const errorFiles: string[] = [];

  for (const [entryName, entry] of jsonEntries) {
    const safeFilename = entryName.split("/").pop() ?? entryName;
    try {
      const buf = Buffer.from(await entry.async("uint8array"));
      const text = buf.toString("utf8");
      const payload = JSON.parse(text) as Record<string, unknown>;
      const articleId = createId();
      const sourceKey = `${batchId}/sources/${articleId}.json`;
      await uploadObject(sourceKey, buf, "application/json");

      const title =
        (typeof payload.title === "string" && payload.title.trim()) ||
        (typeof payload.slug === "string" && payload.slug.trim()) ||
        safeFilename.replace(/\.json$/i, "");

      articleRows.push({
        id: articleId,
        batch_id: batchId,
        title,
        type: "full",
        source_format: "json",
        source_storage_key: sourceKey,
        payload_json: text,
        status: "unassigned",
        enabled: true,
        created_at: now,
        updated_at: now,
      });
    } catch {
      errorFiles.push(safeFilename);
    }
  }

  const { error: batchError } = await supabase.from("batches").insert({
    id: batchId,
    name: item.name,
    domain: item.domain,
    article_type: "full",
    zip_r2_key: canonicalSourceKey,
    total_articles: articleRows.length,
    error_files: errorFiles.length ? JSON.stringify(errorFiles) : null,
    pay_rate_per_article: 0,
    status: "ready",
    assignment_mode: "manual",
    created_by: adminId,
    created_at: now,
    updated_at: now,
  });
  if (batchError) throw batchError;

  if (articleRows.length > 0) {
    const { error: articleError } = await supabase.from("articles").insert(articleRows);
    if (articleError) throw articleError;
  }

  console.log(`created: ${item.name} batchId=${batchId} articles=${articleRows.length} errors=${errorFiles.length}`);
  return { skipped: false, articles: articleRows.length };
}

async function main() {
  const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8")) as ManifestItem[];
  const adminId = await getAdminId();
  let created = 0;
  let skipped = 0;
  let articles = 0;

  for (const item of manifest) {
    const result = await importChunk(item, adminId);
    if (result.skipped) skipped++;
    else created++;
    articles += result.articles;
  }

  console.log(`done created=${created} skipped=${skipped} articles=${articles}`);
}

main().catch((err) => {
  console.error("import-json-chunks-rest failed:", err);
  process.exit(1);
});
