import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD ?? "local-dev-password";
const RUN_ID = Date.now();

const QUEUE_METRICS = [
  {
    key: "policy_violation",
    label: "Vi phạm chính sách",
    scale: { values: ["Failed", "Pass"] },
    required: true,
    sortOrder: 0,
  },
];

interface DatasetSetup {
  datasetId: string;
  metricIds: string[];
  policyMetricKey: string;
  annotatorId: string;
}

interface TaskGroup {
  id: string;
  datasetName: string;
  remainingCount: number;
  skippedCount: number;
  status: string;
}

interface NextTaskPayload {
  done: boolean;
  nextTaskId: string | null;
}

interface TaskDetail {
  id: string;
  assignmentRunId: string;
  internalRowId: number;
  rowId?: string;
  metrics: Array<{ id: string; key: string; label: string; scale: { values: string[] } }>;
}

function adjudicationMetric(page: Page, label: string) {
  return page.getByLabel(`Adjudication metric ${label}`);
}

async function login(page: Page, email: string, landingPath: "/admin" | "/annotator") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL(new RegExp(`${landingPath}`));
}

function rowsForDataset(name: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index + 1}`,
    input: `Queue coverage prompt ${index + 1}`,
    output: `Queue coverage answer ${index + 1}`,
    label: { policy: index % 2 === 0 ? "block" : "allow" },
  }));
}

async function createReadyDataset(request: APIRequestContext, name: string, rowCount: number): Promise<DatasetSetup> {
  const createResponse = await request.post("/api/datasets", {
    data: {
      name,
      domain: "safety_compliance",
      sourceFilename: `${name}.json`,
      rows: rowsForDataset(name, rowCount),
      totalRows: rowCount,
      schemaFingerprint: [
        { path: "input", type: "string", sample: "Queue coverage prompt" },
        { path: "output", type: "string", sample: "Queue coverage answer" },
      ],
      listFields: ["input"],
      detailFields: ["input", "output"],
      metrics: QUEUE_METRICS,
    },
  });
  expect(createResponse.ok()).toBeTruthy();
  const { datasetId } = (await createResponse.json()) as { datasetId: string };

  const annotatorsResponse = await request.get("/api/annotators?status=active");
  expect(annotatorsResponse.ok()).toBeTruthy();
  const annotators = ((await annotatorsResponse.json()) as { data: Array<{ userId: string }> }).data;
  expect(annotators.length).toBeGreaterThan(0);
  const annotatorId = annotators[0].userId;

  const detailResponse = await request.get(`/api/datasets/${datasetId}`);
  expect(detailResponse.ok()).toBeTruthy();
  const metrics = ((await detailResponse.json()) as { metrics: Array<{ id: string; key: string; label: string }> }).metrics;
  const metricIds = metrics.map((metric) => metric.id);
  expect(metricIds.length).toBeGreaterThan(0);
  const policyMetricKey = metrics.find((metric) => metric.label === "Vi phạm chính sách")?.key ?? metrics[0].key;

  const assignResponse = await request.post(`/api/datasets/${datasetId}/assign`, {
    data: {
      scope: { type: "all" },
      targetOverlap: 1,
      metricIds,
      annotatorIds: [annotatorId],
    },
  });
  expect(assignResponse.ok()).toBeTruthy();

  return { datasetId, metricIds, policyMetricKey, annotatorId };
}

async function getTaskGroup(request: APIRequestContext, datasetName: string): Promise<TaskGroup> {
  const response = await request.get("/api/annotator/task-groups");
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { taskGroups: TaskGroup[] };
  const group = payload.taskGroups.find((item) => item.datasetName === datasetName);
  expect(group).toBeTruthy();
  return group as TaskGroup;
}

async function getNextTask(request: APIRequestContext, groupId: string): Promise<NextTaskPayload> {
  const response = await request.get(`/api/annotator/task-groups/${groupId}/next`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as NextTaskPayload;
}

async function getTaskDetail(request: APIRequestContext, taskId: string): Promise<TaskDetail> {
  const response = await request.get(`/api/annotator/tasks/${taskId}`);
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { task: TaskDetail }).task;
}

async function submitTask(request: APIRequestContext, task: TaskDetail, value: "Pass" | "Failed") {
  const values = Object.fromEntries(task.metrics.map((metric) => [metric.id, value]));
  const notes = Object.fromEntries(task.metrics.map((metric, index) => [metric.id, `Queue coverage note ${index + 1}`]));
  const response = await request.post(`/api/annotator/tasks/${task.id}/submit`, { data: { values, notes } });
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toMatchObject({ ok: true, status: "completed", assignmentRunId: task.assignmentRunId });
}

async function firstDatasetRowId(request: APIRequestContext, datasetId: string): Promise<string> {
  const response = await request.get(`/api/datasets/${datasetId}/rows?page=1&pageSize=1&fields=list`);
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { rows: Array<{ id: string }> };
  expect(payload.rows.length).toBe(1);
  return payload.rows[0].id;
}

async function exportJsonl(request: APIRequestContext, datasetId: string) {
  const response = await request.get(`/api/datasets/${datasetId}/export?format=jsonl`);
  expect(response.ok()).toBeTruthy();
  return (await response.text())
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { annotation: { results: Array<{ metrics: Record<string, { value: string | null }> }> }; adjudication?: Record<string, { value: string | null; note: string | null }> });
}

test.describe("annotation queue and adjudication coverage", () => {
  test("annotator skips temporarily and later receives skipped item after other items", async ({ page }) => {
    await login(page, "admin@local.dev", "/admin");
    const datasetName = `Queue Skip ${RUN_ID}`;
    await createReadyDataset(page.request, datasetName, 3);

    await login(page, "annotator@local.dev", "/annotator");
    await page.goto("/annotator/tasks");
    await expect(page.getByRole("heading", { name: "Task được giao" })).toBeVisible();
    const group = await getTaskGroup(page.request, datasetName);
    await expect(page.getByRole("row").filter({ hasText: datasetName }).getByRole("link", { name: "Mở" })).toBeVisible();

    await page.goto(`/annotator/tasks/${group.id}`);
    await expect(page.getByRole("heading", { name: datasetName })).toBeVisible();
    await expect(page.getByText(/Row \d+/)).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get("item")).not.toBeNull();
    const firstTaskId = new URL(page.url()).searchParams.get("item");
    expect(firstTaskId).not.toBeNull();
    await page.getByRole("button", { name: "Skip" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("item")).not.toBe(firstTaskId);

    let next = await getNextTask(page.request, group.id);
    expect(next.done).toBe(false);
    expect(next.nextTaskId).not.toBe(firstTaskId);
    while (!next.done && next.nextTaskId !== firstTaskId) {
      const task = await getTaskDetail(page.request, next.nextTaskId as string);
      await submitTask(page.request, task, "Pass");
      next = await getNextTask(page.request, group.id);
    }

    expect(next).toMatchObject({ done: false, nextTaskId: firstTaskId });
    const refreshedGroup = await getTaskGroup(page.request, datasetName);
    expect(refreshedGroup.skippedCount).toBe(1);
  });

  test("admin saves adjudication without changing annotator vote", async ({ page }) => {
    await login(page, "admin@local.dev", "/admin");
    const datasetName = `Admin Adjudication ${RUN_ID}`;
    const { datasetId, policyMetricKey } = await createReadyDataset(page.request, datasetName, 1);

    await login(page, "annotator@local.dev", "/annotator");
    const group = await getTaskGroup(page.request, datasetName);
    const next = await getNextTask(page.request, group.id);
    expect(next.nextTaskId).not.toBeNull();
    const task = await getTaskDetail(page.request, next.nextTaskId as string);
    await submitTask(page.request, task, "Pass");

    await login(page, "admin@local.dev", "/admin");
    const rowId = task.rowId ?? (await firstDatasetRowId(page.request, datasetId));
    await page.goto(`/admin/datasets/${datasetId}/rows/${rowId}`);
    await expect(page.getByRole("heading", { name: /Row/i })).toBeVisible();
    const policyMetric = adjudicationMetric(page, "Vi phạm chính sách");
    await policyMetric.getByRole("button", { name: "Failed" }).click();
    await policyMetric.getByLabel("Ghi chú final").fill("Reviewer chooses stricter final value");
    await page.getByRole("region", { name: "Adjudication" }).getByRole("button", { name: "Lưu adjudication" }).click();
    await expect(page.getByText("Đã lưu adjudication")).toBeVisible();

    const exportedRows = await exportJsonl(page.request, datasetId);
    const exportedRow = exportedRows.find((row) => row.annotation.results.some((result) => result.metrics[policyMetricKey]?.value === "Pass"));
    expect(exportedRow).toBeTruthy();
    expect(exportedRow?.annotation.results.some((result) => result.metrics[policyMetricKey]?.value === "Pass")).toBeTruthy();
    expect(exportedRow?.adjudication?.[policyMetricKey]).toMatchObject({
      value: "Failed",
      note: "Reviewer chooses stricter final value",
    });
  });

  test("superadmin can open row detail and save adjudication", async ({ page }) => {
    await login(page, "admin@local.dev", "/admin");
    const datasetName = `Superadmin Adjudication ${RUN_ID}`;
    const { datasetId } = await createReadyDataset(page.request, datasetName, 1);

    await login(page, "annotator@local.dev", "/annotator");
    const group = await getTaskGroup(page.request, datasetName);
    const next = await getNextTask(page.request, group.id);
    expect(next.nextTaskId).not.toBeNull();
    const task = await getTaskDetail(page.request, next.nextTaskId as string);
    await submitTask(page.request, task, "Pass");

    await login(page, "superadmin@local.dev", "/admin");
    const rowId = task.rowId ?? (await firstDatasetRowId(page.request, datasetId));
    await page.goto(`/admin/datasets/${datasetId}/rows/${rowId}`);
    await expect(page.getByRole("heading", { name: /Row/i })).toBeVisible();
    const policyMetric = adjudicationMetric(page, "Vi phạm chính sách");
    await policyMetric.getByRole("button", { name: "Pass" }).click();
    await policyMetric.getByLabel("Ghi chú final").fill("Superadmin confirms final value");
    await page.getByRole("region", { name: "Adjudication" }).getByRole("button", { name: "Lưu adjudication" }).click();
    await expect(page.getByText("Đã lưu adjudication")).toBeVisible();
  });

  test("admin sees active import job and duplicate imports are blocked until completion", async ({ page }) => {
    await login(page, "admin@local.dev", "/admin");
    const datasetName = `Import Jobs ${RUN_ID}`;
    const createResponse = await page.request.post("/api/datasets", {
      data: {
        name: datasetName,
        domain: "safety_compliance",
        sourceFilename: "import-jobs.jsonl",
        rows: rowsForDataset(datasetName, 1),
        totalRows: 2,
        schemaFingerprint: [
          { path: "input", type: "string", sample: "Queue coverage prompt" },
          { path: "output", type: "string", sample: "Queue coverage answer" },
        ],
        listFields: ["input"],
        detailFields: ["input", "output"],
        metrics: QUEUE_METRICS,
      },
    });
    expect(createResponse.ok()).toBeTruthy();
    const createPayload = (await createResponse.json()) as { datasetId: string; importId: string };

    await page.goto(`/admin/datasets/${createPayload.datasetId}`);
    await expect(page.getByRole("heading", { name: datasetName })).toBeVisible();
    await expect(page.getByText(/running|queued|in_progress|Đang import/i).first()).toBeVisible();

    const jobsResponse = await page.request.get(`/api/datasets/${createPayload.datasetId}/import-jobs?pageSize=5`);
    expect(jobsResponse.ok()).toBeTruthy();
    const jobsPayload = (await jobsResponse.json()) as { jobs: Array<{ id: string; status: string }> };
    expect(jobsPayload.jobs[0]).toMatchObject({ id: createPayload.importId });

    const duplicateResponse = await page.request.post("/api/datasets", {
      data: {
        name: datasetName,
        domain: "safety_compliance",
        sourceFilename: "import-jobs.jsonl",
        rows: rowsForDataset(datasetName, 1),
        totalRows: 2,
        schemaFingerprint: [
          { path: "input", type: "string", sample: "Queue coverage prompt" },
          { path: "output", type: "string", sample: "Queue coverage answer" },
        ],
        listFields: ["input"],
        detailFields: ["input", "output"],
      },
    });
    expect(duplicateResponse.status()).toBe(409);
    expect(await duplicateResponse.json()).toMatchObject({ error: "DATASET_IMPORT_IN_PROGRESS" });

    const completeResponse = await page.request.post(`/api/datasets/${createPayload.datasetId}/imports`, {
      data: {
        filename: "import-jobs.jsonl",
        rows: rowsForDataset(`${datasetName} Final`, 1),
        importId: createPayload.importId,
        totalRows: 2,
        finalChunk: true,
      },
    });
    expect(completeResponse.ok()).toBeTruthy();
    expect(await completeResponse.json()).toMatchObject({ status: "ready" });

    await page.reload();
    const importJob = page.getByLabel("Import job import-jobs.jsonl").first();
    await expect(importJob).toBeVisible();
    await expect(importJob.getByText("completed")).toBeVisible();
    await expect(page.getByRole("button", { name: "Assign" })).toBeEnabled();
  });
});
