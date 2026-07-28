/**
 * One-shot import: load 2 zip files of legal articles into 2 batches.
 *
 *   under_80_json.zip → batch "Pháp lý — điểm < 80"
 *   over_80_json.zip  → batch "Pháp lý — điểm ≥ 80"
 *
 * Idempotent via batch.name lookup. Re-running skips creation when batch exists.
 *
 * Run: pnpm tsx scripts/import-legal-zips.ts <under_zip_path> <over_zip_path>
 */

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createId } from "@paralleldrive/cuid2";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as schema from "../src/db/schema";

const ADMIN_EMAIL = "admin@example.com";
const PAY_RATE = 150_000;

interface BatchSpec {
  zipPath: string;
  name: string;
  filename: string;
}

const BATCHES: BatchSpec[] = [
  {
    zipPath: process.argv[2] ?? "/Users/haido/Downloads/under_80_json.zip",
    name: "Pháp lý — điểm < 80",
    filename: "under_80_json.zip",
  },
  {
    zipPath: process.argv[3] ?? "/Users/haido/Downloads/over_80_json.zip",
    name: "Pháp lý — điểm ≥ 80",
    filename: "over_80_json.zip",
  },
];

function makeDb() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const client = postgres(process.env.DATABASE_URL, { prepare: false });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

function makeStorage() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function findAdminId(supa: ReturnType<typeof makeStorage>): Promise<string> {
  const { data, error } = await supa.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const admin = data.users.find((u) => u.email === ADMIN_EMAIL);
  if (!admin) throw new Error(`Admin ${ADMIN_EMAIL} not found — run pnpm seed:local first`);
  return admin.id;
}

async function importBatch(
  spec: BatchSpec,
  db: ReturnType<typeof makeDb>["db"],
  supa: ReturnType<typeof makeStorage>,
  adminId: string
) {
  const [existing] = await db
    .select({ id: schema.batches.id })
    .from(schema.batches)
    .where(eq(schema.batches.name, spec.name));

  if (existing) {
    console.log(`  · batch "${spec.name}" already exists (${existing.id}) — skipping`);
    return;
  }

  console.log(`→ Importing "${spec.name}" from ${spec.zipPath}`);
  const zipBuffer = await readFile(resolve(spec.zipPath));
  const zip = await JSZip.loadAsync(zipBuffer);
  const jsonEntries = Object.entries(zip.files).filter(
    ([name, entry]) => !entry.dir && name.toLowerCase().endsWith(".json")
  );
  if (jsonEntries.length === 0) throw new Error(`No JSON entries in ${spec.zipPath}`);

  const batchId = createId();
  const canonicalKey = `${batchId}/${spec.filename}`;
  const { error: zipErr } = await supa.storage
    .from("uploads")
    .upload(canonicalKey, zipBuffer, { contentType: "application/zip", upsert: true });
  if (zipErr) throw new Error(`Zip upload failed: ${zipErr.message}`);

  const articleRows: typeof schema.articles.$inferInsert[] = [];
  const errorFiles: string[] = [];
  const nowMs = Date.now();

  for (const [entryName, entry] of jsonEntries) {
    const safeFilename = entryName.split("/").pop() ?? entryName;
    try {
      const buf = Buffer.from(await entry.async("uint8array"));
      const text = buf.toString("utf8");
      const payload = JSON.parse(text) as Record<string, unknown>;
      const articleId = createId();
      const sourceKey = `${batchId}/sources/${articleId}.json`;
      const { error } = await supa.storage
        .from("uploads")
        .upload(sourceKey, buf, { contentType: "application/json", upsert: true });
      if (error) throw new Error(error.message);

      const title =
        (typeof payload.title === "string" && payload.title.trim()) ||
        (typeof payload.slug === "string" && payload.slug.trim()) ||
        safeFilename.replace(/\.json$/i, "");

      articleRows.push({
        id: articleId,
        batchId,
        title,
        type: "full",
        sourceFormat: "json",
        sourceStorageKey: sourceKey,
        payloadJson: text,
        status: "unassigned",
        enabled: true,
        createdAt: nowMs,
        updatedAt: nowMs,
      });
    } catch (err) {
      console.error(`  · failed to process ${safeFilename}:`, err);
      errorFiles.push(safeFilename);
    }
  }

  await db.insert(schema.batches).values({
    id: batchId,
    name: spec.name,
    domain: "law",
    articleType: "full",
    zipStorageKey: canonicalKey,
    totalArticles: articleRows.length,
    errorFiles: errorFiles.length ? JSON.stringify(errorFiles) : null,
    payRatePerArticle: PAY_RATE,
    status: "ready",
    assignmentMode: "manual",
    createdBy: adminId,
    createdAt: nowMs,
    updatedAt: nowMs,
  });

  if (articleRows.length) {
    await db.insert(schema.articles).values(articleRows);
  }

  console.log(
    `  · ${spec.name}: batch ${batchId} created with ${articleRows.length} articles` +
      (errorFiles.length ? ` (${errorFiles.length} failed)` : "")
  );
}

async function main() {
  const supa = makeStorage();
  const { db, close } = makeDb();
  const adminId = await findAdminId(supa);
  console.log(`Admin: ${adminId}`);

  for (const spec of BATCHES) {
    await importBatch(spec, db, supa, adminId);
  }

  await close();
  console.log("✅ Import complete");
}

main().catch((err) => {
  console.error("import-legal-zips failed:", err);
  process.exit(1);
});
