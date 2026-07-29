import { createClient } from "@supabase/supabase-js";

const MEMBERS = [
  { email: "v.kietthm2@vinsmartfuture.tech", name: "Trương Hầu Minh Kiệt", role: "admin" },
  { email: "v.khanhnt49@vinsmartfuture.tech", name: "Nguyễn Tuấn Khanh", role: "admin" },
  { email: "v.minhlh18@vinsmartfuture.tech", name: "Lê Hoàng Minh", role: "annotator" },
  { email: "v.anhpt246@vinsmartfuture.tech", name: "Phạm Tuấn Anh", role: "annotator" },
  { email: "v.huynh39@vinsmartfuture.tech", name: "Nguyễn Hữu Huy", role: "annotator" },
] as const;

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEY are required");

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const emails: string[] = MEMBERS.map((member) => member.email);
  const { data: users, error: userError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (userError) throw userError;
  const authUserIdsByEmail = new Map(
    users.users
      .filter((user) => user.email && emails.includes(user.email.toLowerCase()))
      .map((user) => [user.email!.toLowerCase(), user.id]),
  );

  const { data: profiles, error: profileError } = await supabase.from("profiles").select("id,email,role,name").in("email", emails);
  if (profileError) throw profileError;
  const profilesByEmail = new Map((profiles ?? []).map((profile: any) => [profile.email.toLowerCase(), profile]));

  const annotatorIds: string[] = [];
  for (const member of MEMBERS) {
    const authUserId = authUserIdsByEmail.get(member.email);
    const profile: any = profilesByEmail.get(member.email);
    if (!authUserId) throw new Error(`Missing auth user: ${member.email}`);
    if (!profile) throw new Error(`Missing profile: ${member.email}`);
    if (profile.id !== authUserId) throw new Error(`Profile/auth id mismatch: ${member.email}`);
    if (profile.role !== member.role) throw new Error(`Wrong role for ${member.email}: ${profile.role}`);
    if (profile.name !== member.name) throw new Error(`Wrong name for ${member.email}: ${profile.name}`);
    if (member.role === "annotator") annotatorIds.push(authUserId);
    console.log(`${member.email}|role=${profile.role}|profile=ok|auth=ok`);
  }

  if (annotatorIds.length > 0) {
    const { data: domains, error: domainError } = await supabase
      .from("expert_domains")
      .select("user_id,domain")
      .in("user_id", annotatorIds)
      .eq("domain", "safety_compliance");
    if (domainError) throw domainError;
    if ((domains ?? []).length !== annotatorIds.length) throw new Error("Missing safety_compliance expert domain for annotators");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
