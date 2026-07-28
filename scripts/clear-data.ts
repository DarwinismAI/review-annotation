/**
 * Clear all data for a clean slate.
 * - Deletes all auth.users via Supabase admin API (cascades to public.profiles).
 * - Drizzle-deletes non-user business tables in FK order.
 * - Wipes every object in the `uploads` Supabase Storage bucket.
 *
 * Run: pnpm tsx scripts/clear-data.ts
 */

import { createClient } from "@supabase/supabase-js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";

function createSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function createDb() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const client = postgres(process.env.DATABASE_URL, { prepare: false });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

// ── Storage wipe (recursive, chunked) ────────────────────────────────────────

type SupabaseAdmin = ReturnType<typeof createSupabaseAdmin>;

async function wipeStorageBucket(supa: SupabaseAdmin, bucket: string): Promise<number> {
  async function wipePrefix(prefix: string, depth = 0): Promise<number> {
    if (depth > 4) return 0;
    let removed = 0;

    const { data, error } = await supa.storage.from(bucket).list(prefix, { limit: 1000 });
    if (error) throw error;

    const entries = data ?? [];
    const fileKeys: string[] = [];

    for (const entry of entries) {
      const child = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        // folder
        removed += await wipePrefix(child, depth + 1);
      } else {
        fileKeys.push(child);
      }
    }

    for (let i = 0; i < fileKeys.length; i += 100) {
      const { error: rmErr } = await supa.storage.from(bucket).remove(fileKeys.slice(i, i + 100));
      if (rmErr) throw rmErr;
      removed += Math.min(100, fileKeys.length - i);
    }
    return removed;
  }

  return wipePrefix("");
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const supa = createSupabaseAdmin();
  const { db, close } = createDb();

  // 1. Delete auth users (cascades to public.profiles via FK ON DELETE CASCADE)
  console.log("→ Deleting auth users...");
  const { data: listData, error: listErr } = await supa.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw listErr;

  for (const user of listData!.users) {
    const { error } = await supa.auth.admin.deleteUser(user.id);
    if (error) throw error;
  }
  console.log(`  · deleted ${listData!.users.length} auth users (profiles cascade)`);

  // 2. Delete business tables in FK-safe order
  console.log("→ Clearing business tables...");
  const tables = [
    schema.articleSegments,
    schema.articleParagraphs,
    schema.assignments,
    schema.articles,
    schema.batches,
    schema.rubricCriteria,
    schema.rubrics,
    schema.expertDomains,
    schema.expertProfiles,
  ] as const;

  for (const table of tables) {
    await db.delete(table);
    console.log(`  · cleared ${(table as { _: { name: string } })._.name ?? "table"}`);
  }

  close();

  // 3. Wipe storage bucket
  console.log("→ Wiping uploads bucket...");
  const n = await wipeStorageBucket(supa, "uploads");
  console.log(`  · removed ${n} storage objects`);

  console.log("Done - database and storage cleared.");
}

main().catch((err) => {
  console.error("clear-data failed:", err);
  process.exit(1);
});
