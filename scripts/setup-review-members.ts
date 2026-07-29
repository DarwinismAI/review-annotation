import { createClient as createLibsqlClient } from "@libsql/client";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createId } from "@paralleldrive/cuid2";

const MEMBERS = [
  { id: "00000000-0000-0000-0000-000000000201", email: "v.kietthm2@vinsmartfuture.tech", name: "Trương Hầu Minh Kiệt", role: "admin" },
  { id: "00000000-0000-0000-0000-000000000202", email: "v.khanhnt49@vinsmartfuture.tech", name: "Nguyễn Tuấn Khanh", role: "admin" },
  { id: "00000000-0000-0000-0000-000000000203", email: "v.minhlh18@vinsmartfuture.tech", name: "Lê Hoàng Minh", role: "annotator" },
  { id: "00000000-0000-0000-0000-000000000204", email: "v.anhpt246@vinsmartfuture.tech", name: "Phạm Tuấn Anh", role: "annotator" },
  { id: "00000000-0000-0000-0000-000000000205", email: "v.huynh39@vinsmartfuture.tech", name: "Nguyễn Hữu Huy", role: "annotator" },
] as const;

type Member = (typeof MEMBERS)[number];

function passwordFor(member: Member) {
  if (member.role === "admin") {
    return (
      process.env.REVIEWER_DEFAULT_PASSWORD ??
      process.env.MEMBER_DEFAULT_PASSWORD ??
      process.env.SEED_ADMIN_PASSWORD ??
      process.env.ADMIN_PASSWORD ??
      process.env.E2E_PASSWORD ??
      process.env.E2E_ADMIN_PASSWORD
    );
  }
  return (
    process.env.LABELING_DEFAULT_PASSWORD ??
    process.env.MEMBER_DEFAULT_PASSWORD ??
    process.env.SEED_EXPERT_PASSWORD ??
    process.env.EXPERT_PASSWORD ??
    process.env.E2E_PASSWORD
  );
}

async function setupLocal() {
  const dbPath = process.env.LOCAL_DB_PATH ?? "file:./local.db";
  const db = createLibsqlClient({ url: dbPath });
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  try {
    for (const member of MEMBERS) {
      await db.execute({
        sql: `INSERT INTO profiles (id, email, role, name, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(email) DO UPDATE SET role = excluded.role, name = excluded.name, updated_at = excluded.updated_at`,
        args: [member.id, member.email, member.role, member.name, nowIso, nowIso],
      });

      if (member.role !== "annotator") {
        await db.execute({ sql: `DELETE FROM expert_profiles WHERE user_id = ?`, args: [member.id] });
        await db.execute({ sql: `DELETE FROM expert_domains WHERE user_id = ?`, args: [member.id] });
        continue;
      }

      await db.execute({
        sql: `INSERT INTO expert_profiles
              (id, user_id, domain, status, invite_token, invite_expires_at, invited_at, activated_at, created_at, updated_at)
              VALUES (?, ?, 'safety_compliance', 'active', NULL, NULL, ?, ?, ?, ?)
              ON CONFLICT(user_id) DO UPDATE SET domain = excluded.domain, status = excluded.status, activated_at = excluded.activated_at, updated_at = excluded.updated_at`,
        args: [`review-member-profile-${member.id.slice(-3)}`, member.id, nowMs, nowMs, nowMs, nowMs],
      });
      await db.execute({ sql: `DELETE FROM expert_domains WHERE user_id = ? AND domain = 'safety_compliance'`, args: [member.id] });
      await db.execute({
        sql: `INSERT INTO expert_domains (id, user_id, domain, created_at) VALUES (?, ?, 'safety_compliance', ?)`,
        args: [`review-member-domain-${member.id.slice(-3)}`, member.id, nowMs],
      });
    }
  } finally {
    db.close();
  }
}

async function setupSupabase() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEY are required");

  const supabase = createSupabaseClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: users, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;

  for (const member of MEMBERS) {
    const password = passwordFor(member);
    if (!password) throw new Error(`Missing password env for ${member.role} users`);

    const existing = users.users.find((user) => user.email?.toLowerCase() === member.email);
    const user =
      existing ??
      (await supabase.auth.admin.createUser({ email: member.email, password, email_confirm: true })).data.user;
    if (!user) throw new Error(`Could not create ${member.email}`);
    if (existing) {
      const { error } = await supabase.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
      if (error) throw error;
    }

    const { error: profileError } = await supabase.from("profiles").upsert(
      {
        id: user.id,
        email: member.email,
        role: member.role,
        name: member.name,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (profileError) throw profileError;

    if (member.role !== "annotator") {
      await supabase.from("expert_domains").delete().eq("user_id", user.id);
      await supabase.from("expert_profiles").delete().eq("user_id", user.id);
      continue;
    }

    const nowMs = Date.now();
    const { error: expertError } = await supabase.from("expert_profiles").upsert(
      {
        id: createId(),
        user_id: user.id,
        domain: "safety_compliance",
        status: "active",
        invited_at: nowMs,
        activated_at: nowMs,
        created_at: nowMs,
        updated_at: nowMs,
      },
      { onConflict: "user_id" },
    );
    if (expertError) throw expertError;

    await supabase.from("expert_domains").delete().eq("user_id", user.id).eq("domain", "safety_compliance");
    const { error: domainError } = await supabase.from("expert_domains").insert({
      id: createId(),
      user_id: user.id,
      domain: "safety_compliance",
      created_at: nowMs,
    });
    if (domainError) throw domainError;
  }
}

async function main() {
  const target = process.env.SETUP_MEMBERS_TARGET ?? "auto";
  const hasSupabaseUrl = Boolean(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (target === "supabase" && !hasSupabaseUrl) {
    throw new Error("SETUP_MEMBERS_TARGET=supabase requires SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
  }
  if (process.env.LOCAL_DB_PATH || !hasSupabaseUrl) {
    await setupLocal();
    console.log(`Configured ${MEMBERS.length} review members in local DB.`);
    return;
  }

  await setupSupabase();
  console.log(`Configured ${MEMBERS.length} review members in Supabase.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
