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
    await expect(page.getByRole("heading", { name: "Phân quyền member" })).toBeVisible();
    await expect(page.getByText("Superadmin")).toBeVisible();
    await expect(page.getByText("Quản trị viên")).toBeVisible();
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
    await expect(annotatorPage).toHaveURL(/\/annotator\/dashboard/);
    await annotatorContext.close();

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await login(adminPage, "admin@local.dev", "/admin");
    await adminPage.goto("/annotator/tasks");
    await expect(adminPage).toHaveURL(/\/admin\/dashboard/);
    await adminContext.close();
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
    await assertPageHealth(page, testInfo, "admin-dataset-detail-desktop");

    const detailResponse = await page.request.get(`/api/datasets/${dataset.id}`);
    expect(detailResponse.ok()).toBeTruthy();
    const detailPayload = await detailResponse.json();
    const requiredFields = detailPayload.dataset.requiredAppendFields as string[];
    expect(requiredFields.length).toBeGreaterThan(0);

    await page.getByLabel("File JSON append").setInputFiles({
      name: "append-missing.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify([{}])),
    });
    await expect(page.getByText("input: thiếu 1 dòng")).toBeVisible();

    await page.getByLabel("File JSON append").setInputFiles({
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
    await page.getByRole("button", { name: "Xác nhận giao" }).click();
    await expect(page.getByText(/Đã tạo \d+ task/)).toBeVisible();
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
    await assertPageHealth(page, testInfo, "annotator-task-detail-desktop");
    expect(errors).toEqual([]);
  });
});
