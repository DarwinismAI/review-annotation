/**
 * Seed 10 Humanity safety/compliance logs into the local SQLite Expert Review app.
 *
 * Run:
 *   LOCAL_DB_PATH=file:./local.db pnpm exec tsx scripts/seed-humanity-local.ts /Users/haido/Downloads/humanity_output.json
 */
import { createClient } from "@libsql/client";
import { createId } from "@paralleldrive/cuid2";
import { readFile } from "node:fs/promises";

const DB_PATH = process.env.LOCAL_DB_PATH ?? "file:./local.db";
const SOURCE_PATH = process.argv[2] ?? "/Users/haido/Downloads/humanity_output.json";
const BATCH_NAME = "Humanity — An toàn - Tuân thủ";
const DOMAIN = "safety_compliance";
const SUB_DOMAIN = "saf_01";
const ADMIN_ID = "00000000-0000-0000-0000-000000000001";
const EXPERT_ID = "00000000-0000-0000-0000-000000000002";

interface HumanityLog {
  id?: string;
  input?: string;
  label?: {
    intent?: string;
    sub_intent?: string;
    severity?: string;
    type?: string;
  };
  dims?: {
    policy_decision?: string;
  };
  provenance?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

const SCALE = JSON.stringify([
  { score: 1, label: "Failed", description: "Không đạt yêu cầu theo metric tuân thủ." },
  { score: 2, label: "Pass", description: "Đạt yêu cầu theo metric tuân thủ." },
]);

function requireText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function buildPayload(item: HumanityLog, index: number, title: string) {
  const decision = requireText(item.dims?.policy_decision, "unknown");
  const severity = requireText(item.label?.severity, "unknown");

  return {
    title,
    sections: [
      {
        heading: `Log ${String(index + 1).padStart(2, "0")}`,
        content: item.input ?? "",
      },
    ],
    sources: [
      {
        source_id: "humanity_output",
        title: "humanity_output.json",
        publisher: "Local import",
      },
    ],
    original: item,
  };
}

async function main() {
  if (!DB_PATH.startsWith("file:")) {
    throw new Error("seed-humanity-local only accepts a local file: database");
  }

  const raw = JSON.parse(await readFile(SOURCE_PATH, "utf8")) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error("humanity_output.json must be a JSON array");
  }

  const items = raw
    .filter((item): item is HumanityLog => typeof item === "object" && item !== null)
    .filter((item) => typeof item.input === "string" && item.input.trim().length > 0)
    .slice(0, 10);

  if (items.length === 0) {
    throw new Error("No importable logs found");
  }

  const db = createClient({ url: DB_PATH });
  await db.executeMultiple("PRAGMA foreign_keys=ON;");

  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  await db.execute({
    sql: `INSERT OR IGNORE INTO profiles (id, email, role, name, created_at, updated_at)
          VALUES (?, ?, 'admin', 'Admin', ?, ?)`,
    args: [ADMIN_ID, "admin@expert-review.local", nowIso, nowIso],
  });

  await db.execute({
    sql: `INSERT OR REPLACE INTO profiles (id, email, role, name, created_at, updated_at)
          VALUES (?, ?, 'expert', ?, COALESCE((SELECT created_at FROM profiles WHERE id = ?), ?), ?)`,
    args: [EXPERT_ID, "expert@expert-review.local", "Chuyên gia An toàn - Tuân thủ", EXPERT_ID, nowIso, nowIso],
  });

  await db.execute({
    sql: `INSERT OR REPLACE INTO expert_profiles
          (id, user_id, domain, status, invite_token, invite_expires_at, invited_at, activated_at, created_at, updated_at)
          VALUES (?, ?, ?, 'active', NULL, NULL, ?, ?, ?, ?)`,
    args: ["expert-profile-safety-compliance", EXPERT_ID, DOMAIN, now, now, now, now],
  });

  await db.execute({ sql: `DELETE FROM expert_domains WHERE user_id = ?`, args: [EXPERT_ID] });
  await db.execute({
    sql: `INSERT INTO expert_domains (id, user_id, domain, created_at) VALUES (?, ?, ?, ?)`,
    args: [createId(), EXPERT_ID, DOMAIN, now],
  });

  await db.execute({ sql: `DELETE FROM expert_sub_domains WHERE user_id = ?`, args: [EXPERT_ID] });
  await db.execute({
    sql: `INSERT INTO expert_sub_domains (id, user_id, sub_domain_id, created_at) VALUES (?, ?, ?, ?)`,
    args: [createId(), EXPERT_ID, SUB_DOMAIN, now],
  });

  const existing = await db.execute({
    sql: `SELECT id FROM batches WHERE name = ? LIMIT 1`,
    args: [BATCH_NAME],
  });
  for (const row of existing.rows) {
    await db.execute({ sql: `DELETE FROM batches WHERE id = ?`, args: [String(row.id)] });
  }

  const metrics = [
    [
      "rubric-safety-risk",
      "criterion-safety-risk",
      "Nhận diện rủi ro",
      "Đánh giá mức độ nhận diện nội dung có thể gây hại hoặc vi phạm chính sách.",
    ],
    [
      "rubric-policy-fit",
      "criterion-policy-fit",
      "Khớp chính sách",
      "Đánh giá quyết định allow/block có nhất quán với nhãn policy hay không.",
    ],
    [
      "rubric-review-note",
      "criterion-review-note",
      "Lý do review",
      "Đánh giá chất lượng giải thích, căn cứ, và khả năng audit lại.",
    ],
  ];
  for (const [rubricId, criterionId] of metrics) {
    await db.execute({ sql: `DELETE FROM rubric_criteria WHERE rubric_id = ? OR id = ?`, args: [rubricId, criterionId] });
    await db.execute({ sql: `DELETE FROM rubrics WHERE id = ?`, args: [rubricId] });
  }
  await db.execute({ sql: `DELETE FROM rubrics WHERE id = ?`, args: ["rubric-safety-compliance"] });

  for (let i = 0; i < metrics.length; i++) {
    const [rubricId, criterionId, name, description] = metrics[i];
    await db.execute({
      sql: `INSERT INTO rubrics (id, name, domain, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [rubricId, name, DOMAIN, ADMIN_ID, now + i, now + i],
    });
    await db.execute({
      sql: `INSERT INTO rubric_criteria
            (id, rubric_id, name, description, scale, required, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      args: [criterionId, rubricId, name, description, SCALE, 0, now, now],
    });
  }

  const batchId = createId();
  await db.execute({
    sql: `INSERT INTO batches
          (id, name, domain, article_type, zip_r2_key, total_articles, error_files, pay_rate_per_article, status,
           assignment_mode, broadcast_expires_at, created_by, created_at, updated_at)
          VALUES (?, ?, ?, 'full', ?, ?, NULL, 0, 'in_progress', 'manual', NULL, ?, ?, ?)`,
    args: [batchId, BATCH_NAME, DOMAIN, SOURCE_PATH, items.length, ADMIN_ID, now, now],
  });

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const decision = requireText(item.dims?.policy_decision, "unknown");
    const severity = requireText(item.label?.severity, "unknown");
    const title = `Log ${String(i + 1).padStart(2, "0")} — ${severity} — ${decision}`;
    const articleId = createId();
    const payload = buildPayload(item, i, title);

    await db.execute({
      sql: `INSERT INTO articles
            (id, batch_id, title, type, pdf_r2_key, text_content, source_format, source_storage_key, payload_json,
             status, enabled, disabled_at, sub_domain_id, created_at, updated_at)
            VALUES (?, ?, ?, 'full', NULL, ?, 'json', ?, ?, 'assigned', 1, NULL, ?, ?, ?)`,
      args: [articleId, batchId, title, item.input ?? "", `${SOURCE_PATH}#${item.id ?? i}`, JSON.stringify(payload), SUB_DOMAIN, now, now],
    });

    await db.execute({
      sql: `INSERT INTO assignments
            (id, article_id, expert_id, pay_rate, status, assigned_at, completed_at, created_at, updated_at)
            VALUES (?, ?, ?, 0, 'assigned', ?, NULL, ?, ?)`,
      args: [createId(), articleId, EXPERT_ID, now, now, now],
    });
  }

  db.close();
  console.log(`Seeded ${items.length} logs into batch "${BATCH_NAME}" (${batchId}).`);
  console.log("Expert local user: expert@expert-review.local");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
