import { expect, test, type Page, type TestInfo } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD ?? "local-dev-password";
const DASH_RE = new RegExp("[\\u2013\\u2014]");
const RUN_ID = Date.now();
const DATASET_NAME = `Playwright Safety Compliance ${RUN_ID}`;
const INITIAL_ROWS = [
  {
    id: `pw-${RUN_ID}-1`,
    input: "Mock safety request asking for a policy boundary.",
    output: "The answer refuses unsafe details and redirects to safe guidance.",
    label: {
      intent: "safety_compliance",
      sub_intent: "policy_boundary",
      policy: "block",
      severity: "P0",
    },
    dims: { policy_decision: "block" },
  },
  {
    id: `pw-${RUN_ID}-2`,
    input: "Mock compliance log about account access controls.",
    output: "The answer provides benign account-security steps.",
    label: {
      intent: "safety_compliance",
      sub_intent: "access_control",
      policy: "allow",
      severity: "P1",
    },
    dims: { policy_decision: "allow" },
  },
];
const E2E_METRICS = [
  {
    key: "policy_violation",
    label: "Vi phạm chính sách",
    scale: { values: ["Failed", "Pass"] },
    required: true,
    sortOrder: 0,
  },
];

let createdDatasetId = "";

async function login(page: Page, email: string, landingPath: "/admin" | "/annotator") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL(new RegExp(`${landingPath}`));
}

function collectRuntimeErrors(page: Page) {
  const messages: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (text.includes("favicon.ico") || text.includes("Failed to load resource: the server responded with a status of 404")) return;
    messages.push(text);
  });
  page.on("pageerror", (error) => messages.push(error.message));
  return messages;
}

function unexpectedRuntimeErrors(messages: string[]) {
  return messages.filter((message) => !message.includes("Failed to load resource: the server responded with a status of 400 (Bad Request)"));
}

async function assertPageHealth(page: Page, testInfo: TestInfo, name: string) {
  await expect(page.locator("body")).toBeVisible();
  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toMatch(DASH_RE);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
}

function setPath(row: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let current = row;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

function buildAppendRow(requiredFields: string[]) {
  const row: Record<string, unknown> = { id: `pw-${Date.now()}`, extra_allowed_field: "ok" };
  for (const field of requiredFields) setPath(row, field, `append ${field}`);
  return row;
}

test.describe.serial("local-dev review annotation flows", () => {
  test("superadmin can inspect member role management on desktop and mobile", async ({ page }, testInfo) => {
    const errors = collectRuntimeErrors(page);
    await login(page, "superadmin@local.dev", "/admin");
    await page.goto("/admin/members");
    await expect(page.getByRole("heading", { name: "Thành viên" })).toBeVisible();
    await expect(page.getByText("Superadmin", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Quản trị viên").first()).toBeVisible();
    await expect(page.getByText("Người gán nhãn").first()).toBeVisible();
    await assertPageHealth(page, testInfo, "superadmin-members-desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    await assertPageHealth(page, testInfo, "superadmin-members-mobile");
    expect(errors).toEqual([]);
  });

  test("role guards keep admin and annotator workspaces separated", async ({ browser }) => {
    const annotatorContext = await browser.newContext();
    const annotatorPage = await annotatorContext.newPage();
    await login(annotatorPage, "annotator@local.dev", "/annotator");
    await annotatorPage.goto("/admin/members");
    await expect(annotatorPage).toHaveURL(/\/annotator\/tasks/);
    await annotatorContext.close();

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await login(adminPage, "admin@local.dev", "/admin");
    await adminPage.goto("/annotator/tasks");
    await expect(adminPage).toHaveURL(/\/admin\/dashboard/);
    await adminContext.close();
  });

  test("legacy entry points redirect to the current workspaces", async ({ browser }) => {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await login(adminPage, "admin@local.dev", "/admin");

    for (const [path, expected] of [
      ["/", /\/admin\/dashboard/],
      ["/admin", /\/admin\/dashboard/],
      ["/admin/dashboard", /\/admin\/dashboard/],
      ["/admin/batches", /\/admin\/datasets/],
      ["/admin/batches/new", /\/admin\/datasets\/new/],
      ["/admin/batches/legacy-batch-id", /\/admin\/datasets/],
      ["/admin/experts", /\/admin\/members/],
    ] as const) {
      await adminPage.goto(path);
      await expect(adminPage).toHaveURL(expected);
    }
    await adminPage.goto("/admin/dashboard");
    await expect(adminPage.getByRole("heading", { name: "Tổng quan" })).toBeVisible();
    await adminContext.close();

    const annotatorContext = await browser.newContext();
    const annotatorPage = await annotatorContext.newPage();
    await login(annotatorPage, "annotator@local.dev", "/annotator");
    await annotatorPage.goto("/annotator");
    await expect(annotatorPage).toHaveURL(/\/annotator\/tasks/);
    await annotatorPage.goto("/annotator/dashboard");
    await expect(annotatorPage).toHaveURL(/\/annotator\/tasks/);
    await annotatorContext.close();
  });

  test("admin cannot assign a dataset while chunked import is incomplete", async ({ page }) => {
    await login(page, "admin@local.dev", "/admin");
    const createResponse = await page.request.post("/api/datasets", {
      data: {
        name: `Partial Import Guard ${RUN_ID}`,
        domain: "safety_compliance",
        sourceFilename: "partial-import.jsonl",
        rows: [INITIAL_ROWS[0]],
        totalRows: 2,
        schemaFingerprint: [
          { path: "input", type: "string", sample: INITIAL_ROWS[0].input },
          { path: "output", type: "string", sample: INITIAL_ROWS[0].output },
        ],
        listFields: ["input"],
        detailFields: ["input", "output"],
        metrics: E2E_METRICS,
      },
    });
    expect(createResponse.ok()).toBeTruthy();
    const partialCreatePayload = await createResponse.json();
    const datasetId = partialCreatePayload.datasetId;

    const duplicateCreateResponse = await page.request.post("/api/datasets", {
      data: {
        name: `Partial Import Guard ${RUN_ID}`,
        domain: "safety_compliance",
        sourceFilename: "partial-import.jsonl",
        rows: [INITIAL_ROWS[0]],
        totalRows: 2,
        schemaFingerprint: [
          { path: "input", type: "string", sample: INITIAL_ROWS[0].input },
          { path: "output", type: "string", sample: INITIAL_ROWS[0].output },
        ],
        listFields: ["input"],
        detailFields: ["input", "output"],
      },
    });
    expect(duplicateCreateResponse.status()).toBe(409);
    expect(await duplicateCreateResponse.json()).toMatchObject({ error: "DATASET_IMPORT_IN_PROGRESS" });

    const annotatorsResponse = await page.request.get("/api/annotators?status=active");
    expect(annotatorsResponse.ok()).toBeTruthy();
    const annotatorIds = ((await annotatorsResponse.json()).data as Array<{ userId: string }>).slice(0, 1).map((item) => item.userId);
    expect(annotatorIds.length).toBe(1);

    const detailResponse = await page.request.get(`/api/datasets/${datasetId}`);
    expect(detailResponse.ok()).toBeTruthy();
    const metricIds = ((await detailResponse.json()).metrics as Array<{ id: string }>).map((metric) => metric.id);
    const assignResponse = await page.request.post(`/api/datasets/${datasetId}/assign`, {
      data: {
        scope: { type: "all" },
        targetOverlap: 1,
        metricIds,
        annotatorIds,
      },
    });
    expect(assignResponse.status()).toBe(409);
    expect(await assignResponse.json()).toMatchObject({ error: "DATASET_NOT_READY" });

    const completeFirstImportResponse = await page.request.post(`/api/datasets/${datasetId}/imports`, {
      data: {
        filename: "partial-import.jsonl",
        rows: [INITIAL_ROWS[1]],
        importId: partialCreatePayload.importId,
        totalRows: 2,
        finalChunk: true,
      },
    });
    expect(completeFirstImportResponse.ok()).toBeTruthy();
    expect(await completeFirstImportResponse.json()).toMatchObject({ status: "ready" });

    const readyCreateResponse = await page.request.post("/api/datasets", {
      data: {
        name: `Partial Append Guard ${RUN_ID}`,
        domain: "safety_compliance",
        sourceFilename: "ready-dataset.json",
        rows: [INITIAL_ROWS[0]],
        totalRows: 1,
        schemaFingerprint: [
          { path: "input", type: "string", sample: INITIAL_ROWS[0].input },
          { path: "output", type: "string", sample: INITIAL_ROWS[0].output },
        ],
        listFields: ["input"],
        detailFields: ["input", "output"],
        metrics: E2E_METRICS,
      },
    });
    expect(readyCreateResponse.ok()).toBeTruthy();
    const readyDatasetId = (await readyCreateResponse.json()).datasetId;
    const appendResponse = await page.request.post(`/api/datasets/${readyDatasetId}/imports`, {
      data: {
        filename: "partial-append.jsonl",
        rows: [buildAppendRow(["input", "output"])],
        totalRows: 2,
        finalChunk: true,
      },
    });
    expect(appendResponse.ok()).toBeTruthy();
    const partialAppendPayload = await appendResponse.json();
    expect(partialAppendPayload).toMatchObject({ status: "importing" });

    const readyDetailResponse = await page.request.get(`/api/datasets/${readyDatasetId}`);
    const readyMetricIds = ((await readyDetailResponse.json()).metrics as Array<{ id: string }>).map((metric) => metric.id);
    const partialAppendAssignResponse = await page.request.post(`/api/datasets/${readyDatasetId}/assign`, {
      data: {
        scope: { type: "all" },
        targetOverlap: 1,
        metricIds: readyMetricIds,
        annotatorIds,
      },
    });
    expect(partialAppendAssignResponse.status()).toBe(409);
    expect(await partialAppendAssignResponse.json()).toMatchObject({ error: "DATASET_NOT_READY" });

    const completeAppendResponse = await page.request.post(`/api/datasets/${readyDatasetId}/imports`, {
      data: {
        filename: "partial-append.jsonl",
        rows: [buildAppendRow(["input", "output"])],
        importId: partialAppendPayload.importId,
        totalRows: 2,
        finalChunk: true,
      },
    });
    expect(completeAppendResponse.ok()).toBeTruthy();
    expect(await completeAppendResponse.json()).toMatchObject({ status: "ready" });
  });

  test("admin can create a dataset, choose display fields, append rows, and assign tasks", async ({ page }, testInfo) => {
    const errors = collectRuntimeErrors(page);
    await login(page, "admin@local.dev", "/admin");
    await page.goto("/admin/datasets/new");
    await expect(page.getByRole("heading", { name: "Tạo dataset" })).toBeVisible();
    await page.getByLabel("Tên dataset").fill(DATASET_NAME);
    await page.getByLabel("File JSON").setInputFiles({
      name: "full-flow-dataset.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(INITIAL_ROWS)),
    });
    await expect(page.getByText(/full-flow-dataset\.json: 2 dòng/)).toBeVisible();
    await expect(page.getByText("input").first()).toBeVisible();
    await expect(page.getByText("label.policy").first()).toBeVisible();
    await expect(page.getByText("Scale: Failed \/ Pass").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Thêm metric" })).toHaveCount(0);
    await assertPageHealth(page, testInfo, "admin-dataset-new-desktop");
    const createResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/datasets") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Tạo dataset" }).click();
    const createResponse = await createResponsePromise;
    expect(createResponse.ok()).toBeTruthy();
    const createPayload = await createResponse.json();
    createdDatasetId = createPayload.datasetId;
    expect(createdDatasetId).not.toEqual("");
    expect(createdDatasetId).not.toEqual("new");
    await expect(page).toHaveURL(new RegExp(`/admin/datasets/${createdDatasetId}$`));

    await page.goto("/admin/datasets");
    await expect(page.getByRole("heading", { name: "Datasets" })).toBeVisible();
    await expect(page.getByText(DATASET_NAME)).toBeVisible();
    await assertPageHealth(page, testInfo, "admin-datasets-desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    await assertPageHealth(page, testInfo, "admin-datasets-mobile");
    await page.setViewportSize({ width: 1440, height: 900 });

    const datasetsResponse = await page.request.get("/api/datasets");
    expect(datasetsResponse.ok()).toBeTruthy();
    const datasetsPayload = await datasetsResponse.json();
    const dataset = datasetsPayload.datasets.find((item: { name: string }) => item.name === DATASET_NAME);
    expect(dataset).toBeTruthy();
    expect(dataset.id).toEqual(createdDatasetId);
    await page.goto(`/admin/datasets/${dataset.id}`);
    await expect(page.getByRole("heading", { name: DATASET_NAME })).toBeVisible();
    const datasetRowsTable = page.locator("table").first();
    await expect(datasetRowsTable.getByRole("columnheader", { name: "input" })).toBeVisible();
    await expect(datasetRowsTable.getByRole("columnheader", { name: "output" })).toHaveCount(0);
    await datasetRowsTable.getByRole("row").filter({ hasText: "Mock safety request asking for a policy boundary." }).click();
    await expect(page.getByRole("dialog", { name: "Row 1" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Row 1" }).getByText("output")).toBeVisible();
    await page.keyboard.press("Escape");
    await assertPageHealth(page, testInfo, "admin-dataset-detail-desktop");

    const detailResponse = await page.request.get(`/api/datasets/${dataset.id}`);
    expect(detailResponse.ok()).toBeTruthy();
    const detailPayload = await detailResponse.json();
    const requiredFields = detailPayload.dataset.requiredAppendFields as string[];
    expect(requiredFields.length).toBeGreaterThan(0);

    await page.getByLabel("File JSON/JSONL append").setInputFiles({
      name: "append-missing.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify([{}])),
    });
    await expect(page.getByText("input: thiếu 1 dòng")).toBeVisible();

    await page.getByLabel("File JSON/JSONL append").setInputFiles({
      name: "append-valid-extra.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify([buildAppendRow(requiredFields)])),
    });
    await expect(page.getByText("File hợp lệ để append")).toBeVisible();
    await expect(page.getByText(/Field thừa:/)).toBeVisible();
    await page.getByRole("button", { name: "Import thêm dòng" }).click();
    await expect(page.getByText("Đã thêm 1 dòng")).toBeVisible();

    await page.getByRole("button", { name: "Assign" }).click();
    await expect(page.getByRole("dialog", { name: "Assign task cho annotator" })).toBeVisible();
    await page.getByRole("button", { name: "Cả dataset" }).click();
    await expect(page.getByLabel("Overlap")).toHaveValue("3");
    await page.getByLabel("Số câu / annotator").fill("1");
    await page.getByRole("button", { name: "Xác nhận giao" }).click();
    await expect(page.getByText("Đã tạo 3 task")).toBeVisible();
    expect(unexpectedRuntimeErrors(errors)).toEqual([]);
  });

  test("annotator autosave, submit, and persisted metric values survive reload", async ({ page }, testInfo) => {
    expect(createdDatasetId).not.toEqual("");
    const errors = collectRuntimeErrors(page);
    await login(page, "annotator@local.dev", "/annotator");
    await page.goto("/annotator/tasks");
    await expect(page.getByRole("heading", { name: "Task của tôi" })).toBeVisible();
    await expect(page.getByText(DATASET_NAME).first()).toBeVisible();
    await assertPageHealth(page, testInfo, "annotator-tasks-desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    await assertPageHealth(page, testInfo, "annotator-tasks-mobile");
    await page.setViewportSize({ width: 1440, height: 900 });

    const tasksResponse = await page.request.get("/api/annotator/tasks");
    expect(tasksResponse.ok()).toBeTruthy();
    const tasksPayload = await tasksResponse.json();
    const task = tasksPayload.tasks.find((item: { datasetName: string; status: string }) => item.datasetName === DATASET_NAME && item.status !== "completed");
    expect(task).toBeTruthy();
    await page.goto(`/annotator/tasks/${task.id}`);
    await expect(page.getByRole("heading", { name: DATASET_NAME })).toBeVisible();

    const taskDetailResponse = await page.request.get(`/api/annotator/tasks/${task.id}`);
    expect(taskDetailResponse.ok()).toBeTruthy();
    const taskDetail = (await taskDetailResponse.json()).task;
    expect(taskDetail.metrics.length).toBeGreaterThan(0);

    const passButtons = page.getByRole("button", { name: "Pass" });
    await expect(passButtons).toHaveCount(taskDetail.metrics.length);
    const notes = page.getByLabel("Ghi chú");
    await expect(notes).toHaveCount(taskDetail.metrics.length);
    for (let index = 0; index < taskDetail.metrics.length; index += 1) {
      await passButtons.nth(index).click();
      await notes.nth(index).fill(`Playwright note ${index + 1}`);
    }

    await expect(page.getByText(/Đã lưu/)).toBeVisible({ timeout: 8_000 });
    const draftResponse = await page.request.get(`/api/annotator/tasks/${task.id}`);
    const draftTask = (await draftResponse.json()).task;
    for (let index = 0; index < taskDetail.metrics.length; index += 1) {
      const metricId = taskDetail.metrics[index].id;
      expect(draftTask.existingValues[metricId]).toEqual({
        value: "Pass",
        note: `Playwright note ${index + 1}`,
      });
    }

    await page.reload();
    await expect(page.getByRole("heading", { name: DATASET_NAME })).toBeVisible();
    for (let index = 0; index < taskDetail.metrics.length; index += 1) {
      await expect(page.getByRole("button", { name: "Pass" }).nth(index)).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByLabel("Ghi chú").nth(index)).toHaveValue(`Playwright note ${index + 1}`);
    }

    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("Đã submit")).toBeVisible();
    const completedResponse = await page.request.get(`/api/annotator/tasks/${task.id}`);
    const completedTask = (await completedResponse.json()).task;
    expect(completedTask.status).toBe("completed");
    for (let index = 0; index < taskDetail.metrics.length; index += 1) {
      const metricId = taskDetail.metrics[index].id;
      expect(completedTask.existingValues[metricId]).toEqual({
        value: "Pass",
        note: `Playwright note ${index + 1}`,
      });
    }
    await page.reload();
    await expect(page.getByRole("heading", { name: DATASET_NAME })).toBeVisible();
    await expect(page.getByText("completed")).toBeVisible();
    for (let index = 0; index < taskDetail.metrics.length; index += 1) {
      await expect(page.getByRole("button", { name: "Pass" }).nth(index)).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByLabel("Ghi chú").nth(index)).toHaveValue(`Playwright note ${index + 1}`);
    }
    await assertPageHealth(page, testInfo, "annotator-task-detail-desktop");
    expect(errors).toEqual([]);
  });

  test("admin can download annotated JSONL with persisted metric values", async ({ browser }) => {
    expect(createdDatasetId).not.toEqual("");
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await login(adminPage, "admin@local.dev", "/admin");

    const exportResponse = await adminPage.request.get(`/api/datasets/${createdDatasetId}/export?format=jsonl`);
    expect(exportResponse.ok()).toBeTruthy();
    expect(exportResponse.headers()["content-type"]).toContain("application/x-ndjson");
    const rows = (await exportResponse.text())
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { data: Record<string, unknown>; annotation: { completed_count: number; results: Array<{ metrics: Record<string, { value: string | null; note: string | null }> }> } });
    expect(rows.length).toBeGreaterThanOrEqual(INITIAL_ROWS.length);
    const annotatedRow = rows.find((row) => row.annotation.completed_count > 0);
    expect(annotatedRow).toBeTruthy();
    expect(annotatedRow?.annotation.results.some((result) => Object.values(result.metrics).some((metric) => metric.value === "Pass"))).toBeTruthy();
    expect(annotatedRow?.annotation.results.some((result) => Object.values(result.metrics).some((metric) => metric.note?.startsWith("Playwright note")))).toBeTruthy();

    await adminContext.close();
  });
});
