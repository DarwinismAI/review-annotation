/**
 * Seed script — Supabase Auth edition.
 * Creates users via admin API (trigger auto-creates profiles rows).
 * Run: pnpm seed:local  OR  npx tsx scripts/seed.ts
 * Safe to re-run: idempotent via email lookup.
 *
 * Requires ALLOW_SEED_MUTATION=1, SEED_ADMIN_PASSWORD, and
 * SEED_EXPERT_PASSWORD.
 */

import { createClient } from "@supabase/supabase-js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

// ── Supabase admin client ────────────────────────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────────────────────────────

type SupabaseAdmin = ReturnType<typeof createSupabaseAdmin>;

/** Get existing user UUID by email, or create via admin API. */
async function upsertAuthUser(
  supa: SupabaseAdmin,
  email: string,
  password: string
): Promise<string> {
  const { data: listData, error: listErr } = await supa.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw listErr;

  const existing = listData!.users.find((u) => u.email === email);
  if (existing) return existing.id;

  const { data, error } = await supa.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (error) throw error;
  return data.user!.id;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (process.env.ALLOW_SEED_MUTATION !== "1") {
    throw new Error("Set ALLOW_SEED_MUTATION=1 to seed data");
  }

  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const expertPassword = process.env.SEED_EXPERT_PASSWORD;
  if (!adminPassword || !expertPassword) {
    throw new Error("SEED_ADMIN_PASSWORD and SEED_EXPERT_PASSWORD are required");
  }

  const supa = createSupabaseAdmin();
  const { db, close } = createDb();
  const nowMs = Date.now();

  console.log("→ Seeding users via Supabase admin API...");

  // 1. Users
  const users = [
    {
      email: "admin@example.com",
      name: "Quản trị viên",
      role: "admin" as const,
      password: adminPassword,
    },
    {
      email: "lan@example.com",
      name: "Nguyễn Thị Lan",
      role: "expert" as const,
      password: expertPassword,
    },
    {
      email: "minh@example.com",
      name: "Trần Văn Minh",
      role: "expert" as const,
      password: expertPassword,
    },
    {
      email: "huong@example.com",
      name: "Lê Thị Hương",
      role: "expert" as const,
      password: expertPassword,
    },
  ];
  const userIds = new Map<string, string>();

  for (const user of users) {
    const userId = await upsertAuthUser(supa, user.email, user.password);
    await db
      .update(schema.profiles)
      .set({ role: user.role, name: user.name, updatedAt: new Date() })
      .where(eq(schema.profiles.id, userId));
    userIds.set(user.email, userId);
  }

  const adminId = userIds.get("admin@example.com")!;
  const lanId = userIds.get("lan@example.com")!;
  const minhId = userIds.get("minh@example.com")!;
  const huongId = userIds.get("huong@example.com")!;

  console.log(`  · admin: ${adminId}`);
  console.log(`  · 3 experts created/reused`);

  // 2. Expert profiles (idempotent via userId unique constraint)
  const experts = [
    { userId: lanId,   domain: "law",     name: "Nguyễn Thị Lan",  domains: ["law"] },
    { userId: minhId,  domain: "medical", name: "Trần Văn Minh",   domains: ["medical"] },
    { userId: huongId, domain: "law",     name: "Lê Thị Hương",    domains: ["law", "medical"] },
  ] as const;

  for (const e of experts) {
    const existing = await db
      .select({ id: schema.expertProfiles.id })
      .from(schema.expertProfiles)
      .where(eq(schema.expertProfiles.userId, e.userId))
      .then((r) => r[0]);

    if (!existing) {
      await db.insert(schema.expertProfiles).values({
        userId: e.userId,
        domain: e.domain,
        status: "active",
        invitedAt: nowMs,
        activatedAt: nowMs,
      });

      await db.insert(schema.expertDomains).values(
        e.domains.map((d) => ({ userId: e.userId, domain: d, createdAt: nowMs }))
      );
      console.log(`  · expert_profiles + domains: ${e.name}`);
    }
  }

  // 3. Default rubric (law)
  const existingRubric = await db
    .select({ id: schema.rubrics.id })
    .from(schema.rubrics)
    .where(eq(schema.rubrics.domain, "law"))
    .then((r) => r[0]);

  let rubricId: string;
  if (existingRubric) {
    rubricId = existingRubric.id;
    console.log("  · law rubric already exists — skipped");
  } else {
    rubricId = createId();
    await db.insert(schema.rubrics).values({
      id: rubricId,
      name: "Rubric pháp luật v1",
      domain: "law",
      createdBy: adminId,
      createdAt: nowMs,
      updatedAt: nowMs,
    });

    const criteria = [
      {
        name: "Độ chính xác pháp lý",
        description: "Đánh giá mức độ chính xác của nội dung pháp lý trong bài viết",
        scale: [
          { score: 1, label: "Yếu",      description: "Có nhiều sai sót pháp lý nghiêm trọng" },
          { score: 2, label: "Trung bình", description: "Có một số sai sót pháp lý cần chỉnh sửa" },
          { score: 3, label: "Khá",      description: "Tương đối chính xác, có vài điểm cần bổ sung" },
          { score: 4, label: "Tốt",      description: "Chính xác, có dẫn chiếu văn bản" },
          { score: 5, label: "Xuất sắc", description: "Hoàn toàn chính xác, dẫn chiếu đầy đủ" },
        ],
      },
      {
        name: "Tính rõ ràng và mạch lạc",
        description: "Đánh giá cấu trúc và sự mạch lạc của bài viết",
        scale: [
          { score: 1, label: "Yếu",      description: "Rất khó hiểu, thiếu cấu trúc" },
          { score: 2, label: "Trung bình", description: "Khó theo dõi, cấu trúc chưa rõ ràng" },
          { score: 3, label: "Khá",      description: "Tương đối rõ ràng, cấu trúc ổn" },
          { score: 4, label: "Tốt",      description: "Rõ ràng, mạch lạc, dễ hiểu" },
          { score: 5, label: "Xuất sắc", description: "Rất rõ ràng, cấu trúc hoàn hảo" },
        ],
      },
      {
        name: "Tính cập nhật",
        description: "Đánh giá mức độ cập nhật của các quy định pháp luật được đề cập",
        scale: [
          { score: 1, label: "Yếu",      description: "Sử dụng các quy định đã hết hiệu lực" },
          { score: 2, label: "Trung bình", description: "Một số quy định chưa được cập nhật" },
          { score: 3, label: "Khá",      description: "Phần lớn quy định còn hiệu lực" },
          { score: 4, label: "Tốt",      description: "Các quy định đều còn hiệu lực" },
          { score: 5, label: "Xuất sắc", description: "Cập nhật đầy đủ, kể cả văn bản mới nhất" },
        ],
      },
    ];

    await db.insert(schema.rubricCriteria).values(
      criteria.map((c, idx) => ({
        id: createId(),
        rubricId,
        name: c.name,
        description: c.description,
        scale: JSON.stringify(c.scale),
        required: 1,
        sortOrder: idx,
        createdAt: nowMs,
        updatedAt: nowMs,
      }))
    );
    console.log("  · law rubric + 3 criteria created");
  }

  // 4. Batches
  const existingBatches = await db
    .select({ id: schema.batches.id })
    .from(schema.batches)
    .then((r) => r.length);

  if (existingBatches === 0) {
    const lawBatchId = createId();
    const medBatchId = createId();

    await db.insert(schema.batches).values([
      {
        id: lawBatchId,
        name: "Batch pháp luật tháng 4/2026",
        domain: "law",
        articleType: "full",
        zipStorageKey: "seed/law-batch-01.zip",
        totalArticles: 10,
        status: "in_progress",
        assignmentMode: "manual",
        payRatePerArticle: 50000,
        createdBy: adminId,
        createdAt: nowMs,
        updatedAt: nowMs,
      },
      {
        id: medBatchId,
        name: "Batch y tế tháng 4/2026",
        domain: "medical",
        articleType: "full",
        zipStorageKey: "seed/medical-batch-01.zip",
        totalArticles: 10,
        status: "ready",
        assignmentMode: "broadcast",
        broadcastExpiresAt: new Date(nowMs + 7 * 24 * 60 * 60 * 1000), // +7 days
        payRatePerArticle: 60000,
        createdBy: adminId,
        createdAt: nowMs,
        updatedAt: nowMs,
      },
    ]);

    // 5. Articles — 10 per batch
    const lawArticles = Array.from({ length: 10 }, (_, i) => ({
      id: createId(),
      batchId: lawBatchId,
      title: `Bài viết pháp luật ${i + 1}: Phân tích điều ${i + 1} Bộ luật Dân sự`,
      type: "full" as const,
      pdfStorageKey: `seed/law-batch-01/article-${i + 1}.pdf`,
      sourceFormat: "pdf" as const,
      status: "unassigned" as const,
      enabled: true,
      createdAt: nowMs,
      updatedAt: nowMs,
    }));

    const medArticles = Array.from({ length: 10 }, (_, i) => ({
      id: createId(),
      batchId: medBatchId,
      title: `Bài viết y tế ${i + 1}: Hướng dẫn điều trị bệnh lý ${i + 1}`,
      type: "full" as const,
      pdfStorageKey: `seed/medical-batch-01/article-${i + 1}.pdf`,
      sourceFormat: "pdf" as const,
      status: "unassigned" as const,
      enabled: true,
      createdAt: nowMs,
      updatedAt: nowMs,
    }));

    await db.insert(schema.articles).values([...lawArticles, ...medArticles]);
    console.log(`  · 2 batches + 20 articles created`);
  } else {
    console.log(`  · batches already exist (${existingBatches}) — skipped`);
  }

  close();
  console.log("✅ Seed complete — 4 users, 2 batches, 20 articles.");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
