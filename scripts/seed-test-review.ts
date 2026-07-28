/**
 * Seed a real, end-to-end reviewable batch for manual/automated QA:
 *   - test expert user (expert@expert-review.local) — pre-created Supabase Auth account
 *   - one batch (`E2E Review Seed`) with 1 article backed by a valid PDF in Supabase Storage
 *   - ensures a law rubric exists (reuses `scripts/seed.ts` output when available)
 *   - creates an assignment linking the expert to the article
 *
 * Safe to re-run: skips anything that already exists.
 *
 * Run with DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * E2E_ADMIN_PASSWORD, and E2E_EXPERT_PASSWORD set explicitly.
 */

import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as schema from "../src/db/schema";

const EXPERT_EMAIL = "expert@expert-review.local";
const EXPERT_NAME = "Chuyên gia Test";
const ADMIN_EMAIL = "admin@expert-review.local";
const BATCH_NAME = "E2E Review Seed";
const ARTICLE_TITLE = "bai-viet-mau-phap-luat.pdf";
const PAY_RATE = 150_000;

/**
 * Build a tiny but RFC-compliant single-page PDF with Vietnamese-ish text
 * (ASCII-safe — Helvetica has no glyphs for accents, the text is just so
 * an expert can confirm they are looking at a real rendered PDF).
 */
function buildSamplePdf(): Buffer {
  const lines = [
    "Bai viet mau - Phap luat lao dong",
    "",
    "Hop dong lao dong la su thoa thuan giua nguoi lao dong va nguoi su dung",
    "lao dong ve viec lam co tra cong, dieu kien lao dong va quyen nghia vu",
    "cua moi ben. Day la ban PDF thu de kiem tra luong review cua chuyen gia.",
    "",
    "Vi du minh hoa: Dieu 13 Bo luat Lao dong 2019 quy dinh cac nguyen tac",
    "giao ket hop dong lao dong tren co so tu nguyen, binh dang, thien chi.",
  ];

  const textOps = [
    "BT",
    "/F1 14 Tf",
    "72 740 Td",
    `(${lines[0]}) Tj`,
    ...lines.slice(1).flatMap((ln) => ["0 -18 Td", `(${ln.replace(/[()\\]/g, (c) => `\\${c}`)}) Tj`]),
    "ET",
  ];
  const stream = textOps.join("\n");
  const streamObj = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;

  const objects: string[] = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj",
    `4 0 obj\n${streamObj}\nendobj`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj",
  ];

  const header = "%PDF-1.4\n%âãÏÓ\n";
  const bytes: Buffer[] = [Buffer.from(header, "binary")];
  const offsets: number[] = [];
  let running = Buffer.byteLength(header, "binary");

  for (const obj of objects) {
    offsets.push(running);
    const b = Buffer.from(obj + "\n", "binary");
    bytes.push(b);
    running += b.length;
  }

  const xrefStart = running;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  bytes.push(Buffer.from(xref + trailer, "binary"));

  return Buffer.concat(bytes);
}

async function createDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL required — Postgres only");
  }
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const client = postgres(process.env.DATABASE_URL, { prepare: false });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

/** Find auth user by email or create via admin API. Trigger mirrors to public.profiles. */
async function findOrCreateAuthUser(
  supa: SupabaseClient,
  email: string,
  password: string,
  name: string,
  role: "admin" | "expert"
): Promise<string> {
  const { data: list, error: listErr } = await supa.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw listErr;
  const existing = list.users.find((u) => u.email === email);
  if (existing) {
    const { error } = await supa.auth.admin.updateUserById(existing.id, {
      password,
      user_metadata: { role, name },
    });
    if (error) throw error;
    return existing.id;
  }

  const { data, error } = await supa.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role, name },
  });
  if (error) throw error;
  return data.user!.id;
}

async function main() {
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminPassword = process.env.E2E_ADMIN_PASSWORD;
  const expertPassword = process.env.E2E_EXPERT_PASSWORD;
  if (!supaUrl || !supaKey) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required");
  if (!adminPassword || !expertPassword) {
    throw new Error("E2E_ADMIN_PASSWORD / E2E_EXPERT_PASSWORD required");
  }
  const sb = createClient(supaUrl, supaKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { db, close } = await createDb();
  console.log("→ Seeding E2E review fixture ...");

  // 1. Admin id (used as createdBy for batch). Auto-created if missing.
  const adminId = await findOrCreateAuthUser(
    sb,
    ADMIN_EMAIL,
    adminPassword,
    "Quản trị viên Test",
    "admin"
  );
  console.log(`  · admin: ${ADMIN_EMAIL} (${adminId})`);

  // 2. Expert user — login via email/password at runtime
  const expertId = await findOrCreateAuthUser(
    sb,
    EXPERT_EMAIL,
    expertPassword,
    EXPERT_NAME,
    "expert"
  );
  console.log(`  · expert: ${EXPERT_EMAIL} (${expertId})`);

  // 3. Law rubric must exist
  const [lawRubric] = await db
    .select({ id: schema.rubrics.id })
    .from(schema.rubrics)
    .where(eq(schema.rubrics.domain, "law"));
  if (!lawRubric) throw new Error("Law rubric missing — run pnpm seed:local first");

  // 4. Batch + article + storage (create if missing)
  const [existingBatch] = await db
    .select({ id: schema.batches.id })
    .from(schema.batches)
    .where(eq(schema.batches.name, BATCH_NAME));

  let batchId: string;
  let articleId: string;

  if (existingBatch) {
    batchId = existingBatch.id;
    const [existingArticle] = await db
      .select({ id: schema.articles.id })
      .from(schema.articles)
      .where(eq(schema.articles.batchId, batchId));
    if (!existingArticle) {
      throw new Error(`Batch ${batchId} has no article — corrupted fixture, wipe and retry`);
    }
    articleId = existingArticle.id;
    console.log(`  · reusing batch ${batchId} (article ${articleId})`);
  } else {
    batchId = createId();
    articleId = createId();
    const pdfKey = `${batchId}/pdfs/${articleId}.pdf`;
    const zipKey = `${batchId}/${BATCH_NAME.replace(/\s+/g, "-")}.zip`;

    const { error: upErr } = await sb.storage
      .from("uploads")
      .upload(pdfKey, buildSamplePdf(), { contentType: "application/pdf", upsert: true });
    if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);
    await sb.storage.from("uploads").upload(zipKey, Buffer.from("seed-placeholder"), {
      contentType: "application/octet-stream",
      upsert: true,
    });

    const nowMs = Date.now();
    await db.insert(schema.batches).values({
      id: batchId,
      name: BATCH_NAME,
      domain: "law",
      articleType: "full",
      zipStorageKey: zipKey,
      totalArticles: 1,
      errorFiles: null,
      payRatePerArticle: PAY_RATE,
      status: "ready",
      createdBy: adminId,
      createdAt: nowMs,
      updatedAt: nowMs,
    });
    await db.insert(schema.articles).values({
      id: articleId,
      batchId,
      title: ARTICLE_TITLE,
      type: "full",
      pdfStorageKey: pdfKey,
      status: "assigned",
      createdAt: nowMs,
      updatedAt: nowMs,
    });
    console.log(`  · created batch ${batchId} + article ${articleId} (PDF at ${pdfKey})`);
  }

  // 5. Colored segments — seed fixture rows for all color types
  const [existingSegment] = await db
    .select({ id: schema.articleSegments.id })
    .from(schema.articleSegments)
    .where(eq(schema.articleSegments.articleId, articleId));

  if (existingSegment) {
    console.log(`  · colored segments already seeded`);
  } else {
    const nowMs = Date.now();
    const fixtureSegments = [
      { order: 0, text: "Điểm tổng: 86.4", color: "green", type: "score", scoreValue: 86.4, pageIndex: 0 },
      { order: 1, text: "Hợp đồng lao động được giao kết theo nguyên tắc tự nguyện, bình đẳng.", color: "green", type: "highlight", scoreValue: null, pageIndex: 0 },
      { order: 2, text: "Chú ý: Điều khoản bảo mật thông tin cần được làm rõ thêm.", color: "yellow", type: "badge", scoreValue: null, pageIndex: 0 },
      { order: 3, text: "Cảnh báo: Thiếu căn cứ pháp lý cho điều khoản chấm dứt hợp đồng.", color: "red", type: "warning", scoreValue: null, pageIndex: 1 },
      { order: 4, text: "Các bên có quyền thỏa thuận về tiền lương và chế độ phúc lợi.", color: "neutral", type: "text", scoreValue: null, pageIndex: 1 },
    ];
    await db.insert(schema.articleSegments).values(
      fixtureSegments.map((seg) => ({
        id: createId(),
        articleId,
        order: seg.order,
        text: seg.text,
        color: seg.color,
        type: seg.type,
        scoreValue: seg.scoreValue,
        pageIndex: seg.pageIndex,
        createdAt: nowMs,
      }))
    );
    console.log(`  · seeded ${fixtureSegments.length} colored segments for article`);
  }

  // 6. Assignment — ensure expert is linked
  const [existingAssignment] = await db
    .select({ id: schema.assignments.id })
    .from(schema.assignments)
    .where(eq(schema.assignments.articleId, articleId));

  if (existingAssignment) {
    console.log(`  · assignment already exists`);
  } else {
    const nowMs = Date.now();
    await db.insert(schema.assignments).values({
      id: createId(),
      articleId,
      expertId,
      payRate: PAY_RATE,
      status: "assigned",
      assignedAt: nowMs,
      createdAt: nowMs,
      updatedAt: nowMs,
    });
    console.log(`  · assigned article to expert`);
  }

  await close();
  console.log(`✅ Seed complete. Login as ${EXPERT_EMAIL} at /login`);
}

main().catch((err) => {
  console.error("seed-test-review failed:", err);
  process.exit(1);
});
