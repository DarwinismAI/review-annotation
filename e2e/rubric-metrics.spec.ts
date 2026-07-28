import { expect, test } from "@playwright/test";
import { createClient } from "@libsql/client";

const ADMIN_COOKIE = { Cookie: "dev_role=admin" };
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const LOCAL_DB_PATH = process.env.LOCAL_DB_PATH ?? "file:./local.db";
const SCALE = [
  { score: 1, label: "Failed", description: "fail" },
  { score: 2, label: "Pass", description: "pass" },
];

function isLocalBaseUrl(baseUrl: string) {
  try {
    return ["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

function createLocalDbClient() {
  if (!LOCAL_DB_PATH.startsWith("file:")) {
    throw new Error("Rubric metric regression tests require a local SQLite database");
  }

  return createClient({ url: LOCAL_DB_PATH });
}

function uniqueId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function createAssignmentFixture(
  db: ReturnType<typeof createLocalDbClient>,
  domain: "law" | "medical" | "tourism" | "safety_compliance",
  createdAt: number,
) {
  const suffix = uniqueId(`metric-assignment-${domain}`);
  const profileId = "00000000-0000-0000-0000-" + Math.random().toString().slice(2, 14).padEnd(12, "0");
  const batchId = `${suffix}-batch`;
  const articleId = `${suffix}-article`;
  const assignmentId = `${suffix}-assignment`;
  const profileTime = new Date(createdAt).toISOString();

  await db.execute({
    sql: `INSERT INTO profiles
            (id, email, role, name, created_at, updated_at)
          VALUES (?, ?, 'expert', 'Metric Fixture Expert', ?, ?)`,
    args: [profileId, `${suffix}@example.test`, profileTime, profileTime],
  });
  await db.execute({
    sql: `INSERT INTO batches
            (id, name, domain, article_type, zip_r2_key, total_articles,
             pay_rate_per_article, status, assignment_mode, created_at, updated_at)
          VALUES (?, ?, ?, 'full', ?, 1, 0, 'in_progress', 'manual', ?, ?)`,
    args: [batchId, suffix, domain, `${suffix}.zip`, createdAt, createdAt],
  });
  await db.execute({
    sql: `INSERT INTO articles
            (id, batch_id, title, type, text_content, source_format, status,
             enabled, created_at, updated_at)
          VALUES (?, ?, ?, 'full', 'Metric fixture', 'json', 'assigned', 1, ?, ?)`,
    args: [articleId, batchId, suffix, createdAt, createdAt],
  });
  await db.execute({
    sql: `INSERT INTO assignments
            (id, article_id, expert_id, pay_rate, status, assigned_at, created_at, updated_at)
          VALUES (?, ?, ?, 0, 'assigned', ?, ?, ?)`,
    args: [assignmentId, articleId, profileId, createdAt, createdAt, createdAt],
  });

  return async () => {
    await db.execute({ sql: "DELETE FROM assignments WHERE id = ?", args: [assignmentId] });
    await db.execute({ sql: "DELETE FROM articles WHERE id = ?", args: [articleId] });
    await db.execute({ sql: "DELETE FROM batches WHERE id = ?", args: [batchId] });
    await db.execute({ sql: "DELETE FROM profiles WHERE id = ?", args: [profileId] });
  };
}

test.describe("Rubric metrics API", () => {
  test.skip(!isLocalBaseUrl(BASE_URL), "Rubric metric tests use dev_role and only run locally");

  test("invalid metric patch does not persist partial rubric changes", async ({ request }) => {
    const create = await request.post("/api/rubrics", {
      headers: ADMIN_COOKIE,
      data: {
        name: `Atomic metric ${Date.now()}`,
        domain: "safety_compliance",
        description: "temporary metric",
        required: true,
        scale: SCALE,
      },
    });
    expect(create.ok()).toBeTruthy();
    const created = (await create.json()).data;

    try {
      const badName = `SHOULD_NOT_PERSIST ${Date.now()}`;
      const patch = await request.patch(`/api/rubrics/${created.id}`, {
        headers: ADMIN_COOKIE,
        data: {
          name: badName,
          domain: "medical",
          scale: [{ score: 1, label: "Only", description: "" }],
        },
      });
      expect(patch.status()).toBe(400);

      const fetchedRes = await request.get(`/api/rubrics/${created.id}`, { headers: ADMIN_COOKIE });
      expect(fetchedRes.ok()).toBeTruthy();
      const fetched = (await fetchedRes.json()).data;
      expect(fetched).toMatchObject(created);
    } finally {
      await request.delete(`/api/rubrics/${created.id}`, { headers: ADMIN_COOKIE });
    }
  });

  test("editing a metric preserves its criterion id", async ({ request }) => {
    const create = await request.post("/api/rubrics", {
      headers: ADMIN_COOKIE,
      data: {
        name: `Stable metric ${Date.now()}`,
        domain: "safety_compliance",
        description: "before",
        required: true,
        scale: SCALE,
      },
    });
    expect(create.ok()).toBeTruthy();
    const created = (await create.json()).data;

    try {
      const patch = await request.patch(`/api/rubrics/${created.id}`, {
        headers: ADMIN_COOKIE,
        data: {
          name: `${created.name} updated`,
          domain: created.domain,
          description: "after",
          required: false,
          scale: SCALE,
        },
      });
      expect(patch.ok()).toBeTruthy();
      const updated = (await patch.json()).data;
      expect(updated.criterionId).toBe(created.criterionId);
      expect(updated).toMatchObject({
        name: `${created.name} updated`,
        description: "after",
        required: false,
      });
    } finally {
      await request.delete(`/api/rubrics/${created.id}`, { headers: ADMIN_COOKIE });
    }
  });

  test("editing a metric applied to an assignment returns METRIC_IN_USE", async ({ request }) => {
    const create = await request.post("/api/rubrics", {
      headers: ADMIN_COOKIE,
      data: {
        name: `Frozen metric ${Date.now()}`,
        domain: "law",
        description: "before",
        required: true,
        scale: SCALE,
      },
    });
    expect(create.ok()).toBeTruthy();
    const created = (await create.json()).data;
    const db = createLocalDbClient();
    const cleanupAssignment = await createAssignmentFixture(db, "law", created.createdAt + 1);

    try {
      const patch = await request.patch(`/api/rubrics/${created.id}`, {
        headers: ADMIN_COOKIE,
        data: {
          name: `${created.name} changed`,
          domain: "medical",
          description: "after",
          required: false,
          scale: [
            { score: 1, label: "Failed", description: "fail" },
            { score: 2, label: "Changed meaning", description: "changed" },
          ],
        },
      });
      expect(patch.status()).toBe(409);
      expect(await patch.json()).toMatchObject({
        error: {
          code: "METRIC_IN_USE",
        },
      });

      const fetched = await request.get(`/api/rubrics/${created.id}`, { headers: ADMIN_COOKIE });
      expect(fetched.ok()).toBeTruthy();
      expect((await fetched.json()).data).toMatchObject(created);
    } finally {
      await cleanupAssignment();
      await db.execute({ sql: "DELETE FROM rubric_criteria WHERE rubric_id = ?", args: [created.id] });
      await db.execute({ sql: "DELETE FROM rubrics WHERE id = ?", args: [created.id] });
      db.close();
    }
  });

  test("moving a metric to a domain with applicable assignments returns METRIC_IN_USE", async ({ request }) => {
    const create = await request.post("/api/rubrics", {
      headers: ADMIN_COOKIE,
      data: {
        name: `Moved metric ${Date.now()}`,
        domain: "law",
        description: "before",
        required: true,
        scale: SCALE,
      },
    });
    expect(create.ok()).toBeTruthy();
    const created = (await create.json()).data;
    const db = createLocalDbClient();
    const cleanupTargetAssignment = await createAssignmentFixture(db, "medical", created.createdAt + 1);

    try {
      const patch = await request.patch(`/api/rubrics/${created.id}`, {
        headers: ADMIN_COOKIE,
        data: {
          name: created.name,
          domain: "medical",
          description: created.description,
          required: created.required,
          scale: created.scale,
        },
      });
      expect(patch.status()).toBe(409);
      expect(await patch.json()).toMatchObject({
        error: {
          code: "METRIC_IN_USE",
        },
      });

      const fetched = await request.get(`/api/rubrics/${created.id}`, { headers: ADMIN_COOKIE });
      expect(fetched.ok()).toBeTruthy();
      expect((await fetched.json()).data).toMatchObject(created);
    } finally {
      await cleanupTargetAssignment();
      await db.execute({ sql: "DELETE FROM rubric_criteria WHERE rubric_id = ?", args: [created.id] });
      await db.execute({ sql: "DELETE FROM rubrics WHERE id = ?", args: [created.id] });
      db.close();
    }
  });

  test("assignments from another domain or before metric creation do not lock editing", async ({ request }) => {
    const create = await request.post("/api/rubrics", {
      headers: ADMIN_COOKIE,
      data: {
        name: `Editable metric ${Date.now()}`,
        domain: "law",
        description: "before",
        required: true,
        scale: SCALE,
      },
    });
    expect(create.ok()).toBeTruthy();
    const created = (await create.json()).data;
    const db = createLocalDbClient();
    const cleanupOldAssignment = await createAssignmentFixture(db, "law", created.createdAt - 1);
    const cleanupOtherDomain = await createAssignmentFixture(db, "medical", created.createdAt + 1);

    try {
      const patch = await request.patch(`/api/rubrics/${created.id}`, {
        headers: ADMIN_COOKIE,
        data: {
          name: `${created.name} updated`,
          domain: created.domain,
          description: "after",
          required: false,
          scale: SCALE,
        },
      });
      expect(patch.ok()).toBeTruthy();
      expect((await patch.json()).data).toMatchObject({
        name: `${created.name} updated`,
        description: "after",
        required: false,
      });
    } finally {
      await cleanupOtherDomain();
      await cleanupOldAssignment();
      await db.execute({ sql: "DELETE FROM rubric_criteria WHERE rubric_id = ?", args: [created.id] });
      await db.execute({ sql: "DELETE FROM rubrics WHERE id = ?", args: [created.id] });
      db.close();
    }
  });

  test("deleting a metric referenced by review scores returns METRIC_IN_USE", async ({ request }) => {
    const create = await request.post("/api/rubrics", {
      headers: ADMIN_COOKIE,
      data: {
        name: `Referenced metric ${Date.now()}`,
        domain: "safety_compliance",
        description: "used by a completed review",
        required: true,
        scale: SCALE,
      },
    });
    expect(create.ok()).toBeTruthy();
    const created = (await create.json()).data;
    const scoreId = uniqueId("rubric-delete-score");
    const db = createLocalDbClient();
    const now = new Date().toISOString();

    await db.execute({
      sql: `INSERT INTO review_scores
              (id, review_id, criterion_id, score, reason, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [scoreId, uniqueId("review"), created.criterionId, 2, "Regression fixture", now, now],
    });

    try {
      const remove = await request.delete(`/api/rubrics/${created.id}`, {
        headers: ADMIN_COOKIE,
      });
      expect(remove.status()).toBe(409);
      expect(await remove.json()).toMatchObject({
        error: {
          code: "METRIC_IN_USE",
        },
      });

      const fetched = await request.get(`/api/rubrics/${created.id}`, {
        headers: ADMIN_COOKIE,
      });
      expect(fetched.ok()).toBeTruthy();
      expect((await fetched.json()).data.criterionId).toBe(created.criterionId);
    } finally {
      await db.execute({
        sql: "DELETE FROM review_scores WHERE id = ?",
        args: [scoreId],
      });
      await db.execute({
        sql: "DELETE FROM rubric_criteria WHERE rubric_id = ?",
        args: [created.id],
      });
      await db.execute({
        sql: "DELETE FROM rubrics WHERE id = ?",
        args: [created.id],
      });
      db.close();
    }
  });

  test("listing metrics does not mutate or split legacy rubric rows", async ({ request }) => {
    const fixturePrefix = uniqueId("legacy-rubric");
    const rubricId = `${fixturePrefix}-rubric`;
    const criterionIds = [`${fixturePrefix}-criterion-1`, `${fixturePrefix}-criterion-2`];
    const db = createLocalDbClient();
    const now = Date.now();

    await db.execute({
      sql: `INSERT INTO rubrics
              (id, name, domain, created_by, created_at, updated_at)
            VALUES (?, ?, ?, NULL, ?, ?)`,
      args: [rubricId, `${fixturePrefix} source`, "tourism", now, now],
    });
    for (const [index, criterionId] of criterionIds.entries()) {
      await db.execute({
        sql: `INSERT INTO rubric_criteria
                (id, rubric_id, name, description, scale, required, sort_order, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          criterionId,
          rubricId,
          `${fixturePrefix} criterion ${index + 1}`,
          `Legacy criterion ${index + 1}`,
          JSON.stringify(SCALE),
          1,
          index,
          now + index,
          now + index,
        ],
      });
    }

    try {
      const beforeRubrics = await db.execute({
        sql: "SELECT * FROM rubrics WHERE id = ?",
        args: [rubricId],
      });
      const beforeCriteria = await db.execute({
        sql: "SELECT * FROM rubric_criteria WHERE id IN (?, ?) ORDER BY id",
        args: criterionIds,
      });

      const response = await request.get("/api/rubrics?domain=tourism", {
        headers: ADMIN_COOKIE,
      });
      expect(response.ok()).toBeTruthy();

      const afterRubrics = await db.execute({
        sql: "SELECT * FROM rubrics WHERE id = ?",
        args: [rubricId],
      });
      const afterCriteria = await db.execute({
        sql: "SELECT * FROM rubric_criteria WHERE id IN (?, ?) ORDER BY id",
        args: criterionIds,
      });
      expect(afterRubrics.rows.map((row) => ({ ...row }))).toEqual(
        beforeRubrics.rows.map((row) => ({ ...row })),
      );
      expect(afterCriteria.rows.map((row) => ({ ...row }))).toEqual(
        beforeCriteria.rows.map((row) => ({ ...row })),
      );

      const metrics = (await response.json()).data;
      expect(metrics.filter((metric: { id: string }) => metric.id === rubricId)).toHaveLength(1);
    } finally {
      await db.execute({
        sql: "DELETE FROM rubric_criteria WHERE id IN (?, ?)",
        args: criterionIds,
      });
      await db.execute({
        sql: "DELETE FROM rubrics WHERE name LIKE ?",
        args: [`${fixturePrefix}%`],
      });
      db.close();
    }
  });
});
