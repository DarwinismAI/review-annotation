import { createClient } from "@libsql/client";
import { expect, test, type APIRequestContext } from "@playwright/test";

const EXPERT_ID = "00000000-0000-0000-0000-000000000002";
const EXPERT_COOKIE = { Cookie: "dev_role=expert" };
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const SCALE = JSON.stringify([
  { score: 1, label: "Failed", description: "fail" },
  { score: 2, label: "Pass", description: "pass" },
]);

type Domain = "law" | "medical" | "tourism";

function isLocalBaseUrl(baseUrl: string) {
  try {
    return ["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

async function createFixture(domain: Domain) {
  const databaseUrl = process.env.LOCAL_DB_PATH;
  if (!databaseUrl) throw new Error("LOCAL_DB_PATH is required");

  const db = createClient({ url: databaseUrl });
  const suffix = `${domain}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const batchId = `snapshot-batch-${suffix}`;
  const articleId = `snapshot-article-${suffix}`;
  const assignmentId = `snapshot-assignment-${suffix}`;
  const existingRubricId = `snapshot-existing-rubric-${suffix}`;
  const newRubricId = `snapshot-new-rubric-${suffix}`;
  const existingCriterionId = `snapshot-existing-criterion-${suffix}`;
  const newCriterionId = `snapshot-new-criterion-${suffix}`;
  const assignmentCreatedAt = Date.now();
  const profileTime = new Date(assignmentCreatedAt).toISOString();

  await db.execute({
    sql: `INSERT OR IGNORE INTO profiles
          (id, email, role, name, created_at, updated_at)
          VALUES (?, ?, 'expert', 'Snapshot Expert', ?, ?)`,
    args: [EXPERT_ID, "expert@expert-review.local", profileTime, profileTime],
  });
  await db.execute({
    sql: `INSERT INTO batches
          (id, name, domain, article_type, zip_r2_key, total_articles,
           pay_rate_per_article, status, assignment_mode, created_at, updated_at)
          VALUES (?, ?, ?, 'full', ?, 1, 0, 'in_progress', 'manual', ?, ?)`,
    args: [batchId, `Snapshot ${domain}`, domain, `snapshot/${suffix}.zip`, assignmentCreatedAt, assignmentCreatedAt],
  });
  await db.execute({
    sql: `INSERT INTO articles
          (id, batch_id, title, type, text_content, source_format, status,
           enabled, created_at, updated_at)
          VALUES (?, ?, ?, 'full', 'Snapshot body', 'json', 'assigned', 1, ?, ?)`,
    args: [articleId, batchId, `Snapshot ${domain}`, assignmentCreatedAt, assignmentCreatedAt],
  });
  await db.execute({
    sql: `INSERT INTO assignments
          (id, article_id, expert_id, pay_rate, status, assigned_at, created_at, updated_at)
          VALUES (?, ?, ?, 0, 'assigned', ?, ?, ?)`,
    args: [assignmentId, articleId, EXPERT_ID, assignmentCreatedAt, assignmentCreatedAt, assignmentCreatedAt],
  });
  await db.execute({
    sql: `INSERT INTO rubrics
          (id, name, domain, created_at, updated_at)
          VALUES (?, 'Existing metric', ?, ?, ?)`,
    args: [existingRubricId, domain, assignmentCreatedAt, assignmentCreatedAt],
  });
  await db.execute({
    sql: `INSERT INTO rubric_criteria
          (id, rubric_id, name, description, scale, required, sort_order, created_at, updated_at)
          VALUES (?, ?, 'Existing metric', '', ?, 1, 0, ?, ?)`,
    args: [existingCriterionId, existingRubricId, SCALE, assignmentCreatedAt, assignmentCreatedAt],
  });
  await db.execute({
    sql: `INSERT INTO rubrics
          (id, name, domain, created_at, updated_at)
          VALUES (?, 'New metric', ?, ?, ?)`,
    args: [newRubricId, domain, assignmentCreatedAt + 1, assignmentCreatedAt + 1],
  });
  await db.execute({
    sql: `INSERT INTO rubric_criteria
          (id, rubric_id, name, description, scale, required, sort_order, created_at, updated_at)
          VALUES (?, ?, 'New metric', '', ?, 1, 0, ?, ?)`,
    args: [newCriterionId, newRubricId, SCALE, assignmentCreatedAt + 1, assignmentCreatedAt + 1],
  });

  return {
    articleId,
    existingCriterionId,
    newCriterionId,
    async cleanup() {
      await db.execute({
        sql: `DELETE FROM review_scores
              WHERE review_id IN (SELECT id FROM reviews WHERE assignment_id = ?)`,
        args: [assignmentId],
      });
      await db.execute({ sql: "DELETE FROM reviews WHERE assignment_id = ?", args: [assignmentId] });
      await db.execute({ sql: "DELETE FROM assignments WHERE id = ?", args: [assignmentId] });
      await db.execute({ sql: "DELETE FROM rubric_criteria WHERE rubric_id IN (?, ?)", args: [existingRubricId, newRubricId] });
      await db.execute({ sql: "DELETE FROM rubrics WHERE id IN (?, ?)", args: [existingRubricId, newRubricId] });
      await db.execute({ sql: "DELETE FROM articles WHERE id = ?", args: [articleId] });
      await db.execute({ sql: "DELETE FROM batches WHERE id = ?", args: [batchId] });
      db.close();
    },
  };
}

async function postScore(
  request: APIRequestContext,
  path: string,
  criterionId: string
) {
  return request.post(path, {
    headers: EXPERT_COOKIE,
    data: { scores: [{ criterionId, score: 2 }] },
  });
}

test.describe("Assignment metric snapshot", () => {
  test.skip(!isLocalBaseUrl(BASE_URL), "Assignment metric snapshot tests use dev_role and only run locally");

  test("review GET excludes metrics created after the assignment", async ({ request }) => {
    const fixture = await createFixture("law");
    try {
      const response = await request.get(`/api/articles/${fixture.articleId}/review`, {
        headers: EXPERT_COOKIE,
      });
      expect(response.ok()).toBeTruthy();

      const body = await response.json();
      expect(body.data.rubric.criteria.map((criterion: { id: string }) => criterion.id)).toEqual([
        fixture.existingCriterionId,
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  test("draft validation rejects a metric created after the assignment", async ({ request }) => {
    const fixture = await createFixture("medical");
    try {
      const existingMetric = await postScore(
        request,
        `/api/articles/${fixture.articleId}/review/draft`,
        fixture.existingCriterionId
      );
      expect(existingMetric.ok()).toBeTruthy();

      const newMetric = await postScore(
        request,
        `/api/articles/${fixture.articleId}/review/draft`,
        fixture.newCriterionId
      );
      expect(newMetric.status()).toBe(400);
      expect((await newMetric.json()).error).toMatchObject({
        code: "INVALID_SCORE",
        criterionId: fixture.newCriterionId,
      });
    } finally {
      await fixture.cleanup();
    }
  });

  test("final submission only requires metrics existing at assignment creation", async ({ request }) => {
    const fixture = await createFixture("tourism");
    try {
      const response = await postScore(
        request,
        `/api/articles/${fixture.articleId}/review`,
        fixture.existingCriterionId
      );
      expect(response.status()).toBe(201);
      expect((await response.json()).data).toMatchObject({ status: "completed" });
    } finally {
      await fixture.cleanup();
    }
  });
});
