/**
 * One-shot: list all auth users + delete every user whose email is NOT in KEEP.
 * Cascades through profiles / expert_profiles / expert_domains / assignments
 * via FK ON DELETE CASCADE in migration 0004.
 *
 * Run: node --env-file=.env.local scripts/nuke-mock-experts.mjs
 */
import { createClient } from "@supabase/supabase-js";

const KEEP = new Set([
  "admin@expert-review.local",
  "cxzharry@gmail.com",
]);

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required");

const supa = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await supa.auth.admin.listUsers({ perPage: 1000 });
if (error) throw error;

console.log(`Total auth users: ${data.users.length}`);
const toDelete = data.users.filter((u) => u.email && !KEEP.has(u.email.toLowerCase()));
const toKeep = data.users.filter((u) => u.email && KEEP.has(u.email.toLowerCase()));

console.log(`KEEP (${toKeep.length}):`);
for (const u of toKeep) console.log(`  ✓ ${u.email}  (${u.id})`);

console.log(`DELETE (${toDelete.length}):`);
for (const u of toDelete) console.log(`  ✗ ${u.email}  (${u.id})`);

if (toDelete.length === 0) {
  console.log("Nothing to nuke.");
  process.exit(0);
}

for (const u of toDelete) {
  const { error: delErr } = await supa.auth.admin.deleteUser(u.id);
  if (delErr) {
    console.error(`  · failed to delete ${u.email}: ${delErr.message}`);
  } else {
    console.log(`  · deleted ${u.email}`);
  }
}

console.log("Done.");
