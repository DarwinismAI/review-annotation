/**
 * Chunk seed_data/travel.zip into N-article batches and upload each chunk to
 * production via the admin API (same path users would use).
 *
 * Usage:
 *   pnpm tsx scripts/import-travel-chunks-prod.ts \
 *     [--zip seed_data/travel.zip] \
 *     [--chunk-size 10] \
 *     [--name-prefix "Du lịch"] \
 *     [--base-url https://expert-review-app.vercel.app]
 *
 * Idempotent by batch name — skips chunks whose batch name already exists.
 */
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

interface Args {
  zip: string;
  chunkSize: number;
  namePrefix: string;
  baseUrl: string;
}

function parseArgs(): Args {
  const out: Args = {
    zip: "seed_data/travel.zip",
    chunkSize: 10,
    namePrefix: "Du lịch",
    baseUrl: process.env.BASE_URL ?? "",
  };
  for (let i = 2; i < process.argv.length; i++) {
    const flag = process.argv[i];
    const val = process.argv[i + 1];
    if (flag === "--zip") out.zip = val;
    else if (flag === "--chunk-size") out.chunkSize = parseInt(val, 10);
    else if (flag === "--name-prefix") out.namePrefix = val;
    else if (flag === "--base-url") out.baseUrl = val;
  }
  return out;
}

let cookieJar = "";

function captureCookies(setCookieHeaders: string[] | string | null) {
  if (!setCookieHeaders) return;
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  for (const h of headers) {
    const cookie = h.split(";")[0];
    const [name] = cookie.split("=");
    cookieJar = cookieJar
      .split("; ")
      .filter((c) => c && !c.startsWith(name + "="))
      .concat(cookie)
      .join("; ");
  }
}

// fetch wrapper: persists Set-Cookie across calls so we keep the admin session.
async function jar(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  if (cookieJar) headers.set("cookie", cookieJar);
  const res = await fetch(url, { ...init, headers, redirect: "manual" });
  // Node fetch exposes Set-Cookie via getSetCookie() in v20+
  const setCookies = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
  if (setCookies?.length) captureCookies(setCookies);
  return res;
}

async function verifyAdminSession(baseUrl: string) {
  const res = await jar(`${baseUrl}/api/auth/me`);
  if (!res.ok) throw new Error(`session check failed: ${res.status} ${await res.text()}`);
  const session = (await res.json()) as { role?: string } | null;
  if (session?.role !== "admin") throw new Error("ADMIN_SESSION_COOKIE is not an admin session");
}

async function batchExists(baseUrl: string, name: string): Promise<boolean> {
  const res = await jar(`${baseUrl}/api/batches?limit=200`);
  if (!res.ok) return false;
  const json = (await res.json()) as { data: Array<{ name: string }> };
  return json.data.some((b) => b.name === name);
}

async function uploadChunk(
  baseUrl: string,
  name: string,
  filename: string,
  zipBytes: Uint8Array
): Promise<{ ok: boolean; articles?: number; error?: string }> {
  // Step 1: signed URL
  const urlRes = await jar(`${baseUrl}/api/batches/upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });
  if (!urlRes.ok) return { ok: false, error: `upload-url ${urlRes.status}` };
  const urlData = (await urlRes.json()) as {
    data: { signedUrl: string; storageKey: string };
  };

  // Step 2: PUT bytes to Supabase Storage
  const putRes = await fetch(urlData.data.signedUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(zipBytes.byteLength),
    },
    body: zipBytes,
    // @ts-expect-error - undici-specific option to send body as a buffer
    duplex: "half",
  });
  if (!putRes.ok) {
    const body = await putRes.text();
    return { ok: false, error: `put ${putRes.status}: ${body.slice(0, 200)}` };
  }

  // Step 3: create batch (server parses ZIP + creates article rows)
  const createRes = await jar(`${baseUrl}/api/batches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      domain: "tourism",
      articleType: "full",
      storageKey: urlData.data.storageKey,
      filename,
      assignmentMode: "manual",
      broadcastExpiresAt: null,
    }),
  });
  if (!createRes.ok) {
    const body = await createRes.text();
    return { ok: false, error: `create ${createRes.status}: ${body}` };
  }
  const created = (await createRes.json()) as {
    data?: { totalArticles?: number };
  };
  return { ok: true, articles: created.data?.totalArticles };
}

async function main() {
  const args = parseArgs();
  if (process.env.ALLOW_PROD_MUTATION !== "1") {
    throw new Error("Set ALLOW_PROD_MUTATION=1 to run the production import");
  }
  if (!args.baseUrl) throw new Error("BASE_URL or --base-url is required");
  new URL(args.baseUrl);
  const adminSessionCookie = process.env.ADMIN_SESSION_COOKIE;
  if (!adminSessionCookie) throw new Error("ADMIN_SESSION_COOKIE is required");
  cookieJar = adminSessionCookie;
  await verifyAdminSession(args.baseUrl);
  console.log("✓ verified admin session");

  console.log(`Loading ${args.zip}…`);
  const zipBuffer = await readFile(resolve(args.zip));
  const zip = await JSZip.loadAsync(zipBuffer);

  const jsonEntries = Object.entries(zip.files).filter(
    ([name, entry]) => !entry.dir && name.toLowerCase().endsWith(".json")
  );
  if (jsonEntries.length === 0) throw new Error("no .json entries in zip");
  console.log(`Found ${jsonEntries.length} articles. Chunking into ${args.chunkSize}/batch…`);

  // Group entries into fixed-size chunks (preserve relative paths inside zip)
  const chunks: typeof jsonEntries[] = [];
  for (let i = 0; i < jsonEntries.length; i += args.chunkSize) {
    chunks.push(jsonEntries.slice(i, i + args.chunkSize));
  }
  console.log(`→ ${chunks.length} chunks`);

  let created = 0,
    skipped = 0,
    failed = 0,
    totalArticles = 0;

  for (let i = 0; i < chunks.length; i++) {
    const idx = String(i + 1).padStart(2, "0");
    const name = `${args.namePrefix} #${idx}`;
    if (await batchExists(args.baseUrl, name)) {
      console.log(`[${idx}/${chunks.length}] skip (exists): ${name}`);
      skipped++;
      continue;
    }

    // Build chunk zip in-memory, preserving relative paths
    const chunkZip = new JSZip();
    for (const [path, entry] of chunks[i]) {
      const data = await entry.async("uint8array");
      chunkZip.file(path, data);
    }
    const bytes = await chunkZip.generateAsync({ type: "uint8array" });
    // Storage keys must be ASCII — strip diacritics from name prefix
    const asciiPrefix = args.namePrefix
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/gi, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const filename = `${asciiPrefix || "tourism"}-${idx}.zip`;

    process.stdout.write(`[${idx}/${chunks.length}] ${name} (${chunks[i].length} articles, ${(bytes.byteLength / 1024).toFixed(0)}KB)… `);
    const t0 = Date.now();
    const result = await uploadChunk(args.baseUrl, name, filename, bytes);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);

    if (result.ok) {
      console.log(`✓ ${dt}s (articles=${result.articles})`);
      created++;
      totalArticles += result.articles ?? 0;
    } else {
      console.log(`✗ ${dt}s: ${result.error}`);
      failed++;
    }
  }

  console.log(`\nDone. created=${created} skipped=${skipped} failed=${failed} totalArticles=${totalArticles}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("import failed:", err);
  process.exit(1);
});
