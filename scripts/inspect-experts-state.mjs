/**
 * Read-only diagnostic: surface every place an "expert" can show up.
 * Auth users / profiles / expert_profiles / expert_domains / assignment expertIds.
 */
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbUrl = process.env.DATABASE_URL;
if (!url || !key || !dbUrl) throw new Error("SUPABASE_URL + SERVICE_ROLE_KEY + DATABASE_URL required");

const supa = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const sql = postgres(dbUrl, { prepare: false });

const { data: au } = await supa.auth.admin.listUsers({ perPage: 1000 });
console.log(`auth.users: ${au.users.length}`);
for (const u of au.users) console.log(`  · ${u.email}  (${u.id})`);

const profiles = await sql`SELECT id, email, role, name FROM profiles ORDER BY created_at`;
console.log(`\nprofiles: ${profiles.length}`);
for (const p of profiles) console.log(`  · ${p.email}  role=${p.role}  name=${p.name ?? "—"}  (${p.id})`);

const expertProfiles = await sql`SELECT user_id, status, domain FROM expert_profiles ORDER BY created_at`;
console.log(`\nexpert_profiles: ${expertProfiles.length}`);
for (const e of expertProfiles) console.log(`  · ${e.user_id}  status=${e.status}  domain=${e.domain}`);

const expertDomains = await sql`SELECT user_id, domain FROM expert_domains ORDER BY user_id`;
console.log(`\nexpert_domains: ${expertDomains.length}`);
for (const e of expertDomains) console.log(`  · ${e.user_id}  domain=${e.domain}`);

const assignmentExperts = await sql`
  SELECT expert_id, COUNT(*) AS n
  FROM assignments
  GROUP BY expert_id
  ORDER BY n DESC
`;
console.log(`\nassignments — distinct expert_id: ${assignmentExperts.length}`);
for (const a of assignmentExperts) console.log(`  · ${a.expert_id}  count=${a.n}`);

const reviewExperts = await sql`
  SELECT expert_id, COUNT(*) AS n
  FROM reviews
  GROUP BY expert_id
  ORDER BY n DESC
`;
console.log(`\nreviews — distinct expert_id: ${reviewExperts.length}`);
for (const r of reviewExperts) console.log(`  · ${r.expert_id}  count=${r.n}`);

await sql.end();
