import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { annotationAdjudications, annotationAssignments, annotationResults, datasets } from "@/db/datasets";

type CookieJar = Map<string, string>;

interface DirectAssignment {
  id: string;
  status: string;
  rowId: string;
  annotatorId: string;
  skippedAt: Date | string | null;
  skipCount: number;
  completedAt: Date | string | null;
}

interface DirectResult {
  assignmentId: string;
  rowId: string;
  annotatorId: string;
  metricId: string;
  value: string | null;
  note: string | null;
  updatedAt: Date | string;
}

interface DirectAdjudication {
  rowId: string;
  metricId: string;
  metricKey: string;
  reviewerId: string | null;
  value: string | null;
  note: string | null;
  updatedAt: Date | string;
}

const BASE_URL = process.env.PERSISTENCE_BASE_URL ?? process.env.E2E_BASE_URL ?? process.env.BASE_URL;
const HASH_SALT = process.env.PERSISTENCE_HASH_SALT ?? "api-fast-path-persistence";

function argValue(name: string): string | null {
  const prefix = `${name}=`;
  const arg = process.argv.slice(2).find((item) => item === name || item.startsWith(prefix));
  if (!arg) return null;
  return arg === name ? "1" : arg.slice(prefix.length);
}

function normalizeBaseUrl() {
  const raw = argValue("--base-url") ?? BASE_URL;
  if (!raw) throw new Error("ENV: set PERSISTENCE_BASE_URL, E2E_BASE_URL, BASE_URL, or --base-url.");
  return raw.replace(/\/$/, "");
}

function targetName() {
  return argValue("--target") ?? process.env.PERSISTENCE_TARGET ?? "local";
}

function hashId(value: string | null | undefined) {
  if (!value) return null;
  return createHash("sha256").update(HASH_SALT).update(":").update(value).digest("hex").slice(0, 16);
}

function cookieHeader(jar: CookieJar): string {
  return Array.from(jar.entries()).map(([key, value]) => `${key}=${value}`).join("; ");
}

function storeCookies(jar: CookieJar, response: Response) {
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const rawCookies = getSetCookie ? getSetCookie.call(response.headers) : response.headers.get("set-cookie") ? [response.headers.get("set-cookie") as string] : [];
  for (const rawCookie of rawCookies) {
    const [pair] = rawCookie.split(";");
    const separator = pair.indexOf("=");
    if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function jarFromCookie(rawCookie: string | undefined): CookieJar | null {
  if (!rawCookie) return null;
  const jar: CookieJar = new Map();
  for (const part of rawCookie.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key && valueParts.length > 0) jar.set(key, valueParts.join("="));
  }
  return jar.size > 0 ? jar : null;
}

async function loginWithDevEndpoint(baseUrl: string, role: "admin" | "annotator"): Promise<CookieJar | null> {
  const jar: CookieJar = new Map();
  const email = role === "admin" ? "admin@local.dev" : "annotator@local.dev";
  const password =
    role === "admin"
      ? process.env.ADMIN_PASSWORD ?? process.env.E2E_ADMIN_PASSWORD ?? process.env.E2E_PASSWORD ?? "local-dev-password"
      : process.env.EXPERT_PASSWORD ?? process.env.E2E_EXPERT_PASSWORD ?? process.env.E2E_PASSWORD ?? "local-dev-password";
  const response = await fetch(`${baseUrl}/api/dev/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`ENV: ${role} dev login failed with HTTP ${response.status}`);
  storeCookies(jar, response);
  return jar;
}

async function authJar(baseUrl: string, role: "admin" | "annotator"): Promise<CookieJar> {
  const cookieEnv = role === "admin" ? process.env.PERSISTENCE_ADMIN_COOKIE : process.env.PERSISTENCE_ANNOTATOR_COOKIE;
  const fromCookie = jarFromCookie(cookieEnv);
  if (fromCookie) return fromCookie;

  const fromDevLogin = await loginWithDevEndpoint(baseUrl, role);
  if (fromDevLogin) return fromDevLogin;

  throw new Error(`ENV: ${role} auth unavailable. Provide PERSISTENCE_${role.toUpperCase()}_COOKIE for deployed targets.`);
}

async function apiJson<T>(baseUrl: string, jar: CookieJar, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      cookie: cookieHeader(jar),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  if (response.status >= 500) throw new Error(`${path} returned HTTP ${response.status}`);
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${path} returned invalid JSON`);
  }
}

async function directAssignments(ids: string[]): Promise<DirectAssignment[]> {
  if (ids.length === 0) return [];
  return db
    .select({
      id: annotationAssignments.id,
      status: annotationAssignments.status,
      rowId: annotationAssignments.rowId,
      annotatorId: annotationAssignments.annotatorId,
      skippedAt: annotationAssignments.skippedAt,
      skipCount: annotationAssignments.skipCount,
      completedAt: annotationAssignments.completedAt,
    })
    .from(annotationAssignments)
    .where(inArray(annotationAssignments.id, ids)) as Promise<DirectAssignment[]>;
}

async function directResults(assignmentId: string): Promise<DirectResult[]> {
  return db
    .select({
      assignmentId: annotationResults.assignmentId,
      rowId: annotationResults.rowId,
      annotatorId: annotationResults.annotatorId,
      metricId: annotationResults.metricId,
      value: annotationResults.value,
      note: annotationResults.note,
      updatedAt: annotationResults.updatedAt,
    })
    .from(annotationResults)
    .where(eq(annotationResults.assignmentId, assignmentId)) as Promise<DirectResult[]>;
}

async function directAdjudications(datasetId: string, rowId: string): Promise<DirectAdjudication[]> {
  return db
    .select({
      rowId: annotationAdjudications.rowId,
      metricId: annotationAdjudications.metricId,
      metricKey: annotationAdjudications.metricKey,
      reviewerId: annotationAdjudications.reviewerId,
      value: annotationAdjudications.value,
      note: annotationAdjudications.note,
      updatedAt: annotationAdjudications.updatedAt,
    })
    .from(annotationAdjudications)
    .where(and(eq(annotationAdjudications.datasetId, datasetId), eq(annotationAdjudications.rowId, rowId))) as Promise<DirectAdjudication[]>;
}

function redactAssignment(assignment: DirectAssignment) {
  return {
    idHash: hashId(assignment.id),
    rowIdHash: hashId(assignment.rowId),
    annotatorIdHash: hashId(assignment.annotatorId),
    status: assignment.status,
    skipped: Boolean(assignment.skippedAt),
    skipCount: Number(assignment.skipCount ?? 0),
    completed: Boolean(assignment.completedAt),
  };
}

function redactResult(result: DirectResult) {
  return {
    assignmentIdHash: hashId(result.assignmentId),
    rowIdHash: hashId(result.rowId),
    annotatorIdHash: hashId(result.annotatorId),
    metricIdHash: hashId(result.metricId),
    value: result.value,
    note: result.note,
    updated: Boolean(result.updatedAt),
  };
}

function redactAdjudication(adjudication: DirectAdjudication) {
  return {
    rowIdHash: hashId(adjudication.rowId),
    metricIdHash: hashId(adjudication.metricId),
    reviewerIdHash: hashId(adjudication.reviewerId),
    metricKey: adjudication.metricKey,
    value: adjudication.value,
    note: adjudication.note,
    updated: Boolean(adjudication.updatedAt),
  };
}

async function main() {
  const baseUrl = normalizeBaseUrl();
  const target = targetName();
  const adminJar = await authJar(baseUrl, "admin");
  const annotatorJar = await authJar(baseUrl, "annotator");
  const runId = Date.now();
  const datasetName = `Persistence Gate ${runId}`;
  let datasetId: string | null = null;
  const evidence: Record<string, unknown> = {
    target,
    hostHash: hashId(new URL(baseUrl).host),
    startedAt: new Date().toISOString(),
    checks: [],
  };

  try {
    const createPayload = await apiJson<{ datasetId: string }>(baseUrl, adminJar, "/api/datasets", {
      method: "POST",
      body: JSON.stringify({
        name: datasetName,
        domain: "safety_compliance",
        sourceFilename: "persistence-gate.jsonl",
        rows: [
          { id: `persist-${runId}-1`, input: "Persistence draft and submit row", output: "Reference answer one" },
          { id: `persist-${runId}-2`, input: "Persistence skip row", output: "Reference answer two" },
        ],
        totalRows: 2,
        schemaFingerprint: [
          { path: "input", type: "string", sample: "Persistence prompt" },
          { path: "output", type: "string", sample: "Reference answer" },
        ],
        listFields: ["input"],
        detailFields: ["input", "output"],
        metrics: [
          {
            key: "policy_violation",
            label: "Vi phạm chính sách",
            scale: { values: ["Failed", "Pass"] },
            required: true,
            sortOrder: 0,
          },
        ],
      }),
    });
    datasetId = createPayload.datasetId;

    const detail = await apiJson<{ metrics: Array<{ id: string; key: string }> }>(baseUrl, adminJar, `/api/datasets/${datasetId}`);
    const metricId = detail.metrics[0]?.id;
    if (!metricId) throw new Error("PERSISTENCE: created dataset has no metric");

    const annotators = await apiJson<{ data: Array<{ userId: string }> }>(baseUrl, adminJar, "/api/annotators?status=active");
    const annotatorId = annotators.data[0]?.userId;
    if (!annotatorId) throw new Error("PERSISTENCE: no active annotator available");

    await apiJson(baseUrl, adminJar, `/api/datasets/${datasetId}/assign`, {
      method: "POST",
      body: JSON.stringify({
        scope: { type: "all" },
        targetOverlap: 1,
        metricIds: [metricId],
        annotatorIds: [annotatorId],
      }),
    });

    const groups = await apiJson<{ taskGroups: Array<{ id: string; datasetName: string }> }>(baseUrl, annotatorJar, "/api/annotator/task-groups");
    const group = groups.taskGroups.find((item) => item.datasetName === datasetName);
    if (!group) throw new Error("PERSISTENCE: created task group not visible to annotator");

    const firstNext = await apiJson<{ done: boolean; nextTaskId: string | null }>(baseUrl, annotatorJar, `/api/annotator/task-groups/${group.id}/next`);
    if (!firstNext.nextTaskId) throw new Error("PERSISTENCE: no first task available");
    const firstTask = await apiJson<{ task: { id: string; metrics: Array<{ id: string }> } }>(baseUrl, annotatorJar, `/api/annotator/tasks/${firstNext.nextTaskId}`);

    evidence.before = {
      assignments: (await directAssignments([firstTask.task.id])).map(redactAssignment),
      results: (await directResults(firstTask.task.id)).map(redactResult),
    };

    await apiJson(baseUrl, annotatorJar, `/api/annotator/tasks/${firstTask.task.id}/draft`, {
      method: "POST",
      body: JSON.stringify({ values: { [metricId]: "Failed" }, notes: { [metricId]: "draft persisted" } }),
    });
    const draftAssignments = await directAssignments([firstTask.task.id]);
    const draftResults = await directResults(firstTask.task.id);
    if (draftAssignments[0]?.status !== "in_progress") throw new Error("PERSISTENCE: draft did not set assignment in_progress");
    if (draftResults[0]?.value !== "Failed" || draftResults[0]?.note !== "draft persisted") {
      throw new Error("PERSISTENCE: draft result values were not persisted");
    }

    await apiJson(baseUrl, annotatorJar, `/api/annotator/tasks/${firstTask.task.id}/submit`, {
      method: "POST",
      body: JSON.stringify({ values: { [metricId]: "Pass" }, notes: { [metricId]: "submit persisted" } }),
    });
    const submittedAssignments = await directAssignments([firstTask.task.id]);
    const submittedResults = await directResults(firstTask.task.id);
    const submittedAssignment = submittedAssignments[0];
    if (!submittedAssignment) throw new Error("PERSISTENCE: submitted assignment was not found");
    if (submittedAssignment.status !== "completed") throw new Error("PERSISTENCE: submit did not complete assignment");
    if (submittedResults[0]?.value !== "Pass" || submittedResults[0]?.note !== "submit persisted") {
      throw new Error("PERSISTENCE: submit result values were not persisted");
    }

    const secondNext = await apiJson<{ done: boolean; nextTaskId: string | null }>(baseUrl, annotatorJar, `/api/annotator/task-groups/${group.id}/next`);
    if (!secondNext.nextTaskId) throw new Error("PERSISTENCE: no second task available for skip");
    await apiJson(baseUrl, annotatorJar, `/api/annotator/tasks/${secondNext.nextTaskId}/skip`, { method: "POST" });
    const skippedAssignments = await directAssignments([secondNext.nextTaskId]);
    if (!skippedAssignments[0]?.skippedAt || skippedAssignments[0].skipCount < 1) {
      throw new Error("PERSISTENCE: skip state was not persisted");
    }

    const adjudicationRowId = submittedAssignment.rowId;
    if (!adjudicationRowId) throw new Error("PERSISTENCE: submitted assignment has no row id");
    await apiJson<{ adjudications: unknown[] }>(baseUrl, adminJar, `/api/datasets/${datasetId}/rows/${adjudicationRowId}/adjudication`, {
      method: "POST",
      body: JSON.stringify({ values: { [metricId]: "Failed" }, notes: { [metricId]: "adjudication persisted" } }),
    });
    const adjudications = await directAdjudications(datasetId, adjudicationRowId);
    if (adjudications[0]?.value !== "Failed" || adjudications[0]?.note !== "adjudication persisted") {
      throw new Error("PERSISTENCE: adjudication values were not persisted");
    }
    const postAdjudicationResults = await directResults(firstTask.task.id);
    const submittedResult = submittedResults.find((result) => result.metricId === metricId);
    const postAdjudicationResult = postAdjudicationResults.find((result) => result.metricId === metricId);
    if (!submittedResult || !postAdjudicationResult) {
      throw new Error("PERSISTENCE: annotator result missing before or after adjudication");
    }
    if (postAdjudicationResult.value !== submittedResult.value || postAdjudicationResult.note !== submittedResult.note) {
      throw new Error("PERSISTENCE: adjudication mutated annotator result values");
    }

    evidence.after = {
      submittedAssignment: submittedAssignments.map(redactAssignment),
      submittedResults: submittedResults.map(redactResult),
      postAdjudicationResults: postAdjudicationResults.map(redactResult),
      skippedAssignment: skippedAssignments.map(redactAssignment),
      adjudications: adjudications.map(redactAdjudication),
    };
    evidence.checks = [
      "draft persisted",
      "submit persisted",
      "skip persisted",
      "adjudication persisted",
      "annotator result preserved after adjudication",
    ];
  } finally {
    if (datasetId && argValue("--no-cleanup") !== "1") {
      await db.delete(datasets).where(eq(datasets.id, datasetId));
      evidence.cleanup = { datasetDeleted: true };
    }
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const outDir = `test-results/api-fast-path-${stamp}`;
  await mkdir(outDir, { recursive: true });
  await writeFile(`${outDir}/persistence.json`, JSON.stringify(evidence, null, 2));
  console.log(`Persistence evidence: ${outDir}/persistence.json`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
