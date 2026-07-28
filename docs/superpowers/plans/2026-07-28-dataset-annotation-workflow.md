# Dataset Annotation Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dataset-first annotation workflow where admins upload JSON datasets, choose list/detail display fields, append compatible rows, assign rows to annotators with overlap, and annotators submit Pass/Failed metric results.

**Architecture:** Add dataset entities next to the existing batch/article review model instead of rewriting it. Keep the internal auth role `expert`, but rename user-facing copy to Annotator/Người gán nhãn and create dataset-specific admin plus annotator task APIs/pages. Store raw row JSON durably, project configured field paths for list/detail display, and validate metric submissions against dataset metric scales.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Drizzle ORM, PostgreSQL migrations, SQLite local seed SQL, zod, Playwright, tsx assertion scripts.

---

## File Map

- Create `src/lib/datasets/json-paths.ts`: flatten JSON records into selectable field paths, detect value types, read nested path values, project list/detail fields.
- Create `src/lib/datasets/import-validation.ts`: parse JSON arrays, validate selected display fields, compute required append fields, report missing append fields.
- Create `src/lib/datasets/metrics.ts`: validate metric config and submitted metric values against declared scales.
- Create `src/lib/datasets/assignment.ts`: pure balanced overlap assignment planner.
- Create `src/lib/datasets/aggregation.ts`: compute row overlap, completed count, annotated-by users, and agreement percentage from assignment/result rows.
- Create `src/db/datasets.ts`: PostgreSQL Drizzle tables for dataset workflow.
- Create `src/db/datasets.sqlite.ts`: SQLite Drizzle mirror for local dev.
- Create `migrations/0013_dataset_annotation_workflow.sql`: production table/index migration.
- Modify `src/db/client.ts`: include dataset schemas in the Drizzle schema bundle.
- Modify `drizzle.config.ts`: include dataset schema files in both Postgres and SQLite generation.
- Modify `scripts/seed-local.ts`: create dataset tables for local SQLite.
- Modify `package.json`: add `test:datasets`.
- Create `tests/datasets/run.ts`: lightweight assertion runner.
- Create `tests/datasets/import-validation.test.ts`: import and append compatibility tests.
- Create `tests/datasets/assignment.test.ts`: assignment planner tests.
- Create `tests/datasets/metrics.test.ts`: metric config/submission validation tests.
- Create `src/app/api/datasets/inspect/route.ts`: admin JSON inspect endpoint.
- Create `src/app/api/datasets/route.ts`: admin dataset create/list endpoint.
- Create `src/app/api/datasets/[id]/route.ts`: admin dataset detail endpoint.
- Create `src/app/api/datasets/[id]/rows/route.ts`: admin row list aggregation endpoint.
- Create `src/app/api/datasets/[id]/imports/inspect/route.ts`: admin append preflight endpoint.
- Create `src/app/api/datasets/[id]/imports/route.ts`: admin append import endpoint.
- Create `src/app/api/datasets/[id]/assign/route.ts`: admin balanced assignment endpoint.
- Create `src/app/api/annotator/tasks/route.ts`: current annotator task list endpoint guarded by `requireExpert`.
- Create `src/app/api/annotator/tasks/[id]/route.ts`: current annotator task detail endpoint.
- Create `src/app/api/annotator/tasks/[id]/submit/route.ts`: current annotator submit endpoint.
- Create `src/components/admin/dataset-field-selector.tsx`: list/detail field picker.
- Create `src/components/admin/dataset-metrics-editor.tsx`: dataset metric editor with binary scale defaults.
- Create `src/components/admin/dataset-row-table.tsx`: row table with configured list fields, completed count, avatars, agreement, overlap.
- Create `src/components/admin/dataset-append-import-panel.tsx`: append JSON validation and import UI.
- Create `src/components/admin/dataset-assign-modal.tsx`: assign selected/all rows to annotators with target overlap and metrics.
- Create `src/components/admin/annotator-avatar-stack.tsx`: compact annotator initials.
- Create `src/components/admin/overlap-badge.tsx`: `3/3` and `thiếu 1` badge.
- Create `src/components/admin/agreement-badge.tsx`: agreement bar and percent.
- Create `src/components/admin/json-field-value.tsx`: safe field value rendering for strings, numbers, booleans, arrays, objects, nulls.
- Create `src/app/admin/datasets/page.tsx`: admin dataset list.
- Create `src/app/admin/datasets/new/page.tsx`: upload, inspect, confirm list/detail fields, metrics, create dataset.
- Create `src/app/admin/datasets/[id]/page.tsx`: dataset row list, append import, assign modal.
- Create `src/app/expert/tasks/page.tsx`: annotator task list under existing expert auth segment.
- Create `src/app/expert/tasks/[id]/page.tsx`: annotator dataset row detail and metric scoring UI.
- Modify `src/components/app-sidebar.tsx`, `src/components/app-mobile-nav.tsx`, `src/components/app-header.tsx`, `src/lib/labels.ts`: add admin dataset nav and change visible expert copy to Annotator/Người gán nhãn.
- Modify `src/app/admin/experts/page.tsx`, `src/app/expert/dashboard/page.tsx`, `src/app/expert/profile/page.tsx`, `src/app/login/page.tsx`, `src/app/signup/page.tsx`, `src/app/signup/profile/page.tsx`: rename visible expert wording without changing DB role values.
- Create `e2e/dataset-annotation-workflow.spec.ts`: browser coverage for create, append validation, assign, annotator task render, submit validation.
- Create `scripts/seed-humanity-dataset-local.ts`: seed 10 rows from `/Users/haido/Downloads/humanity_output.json` into the dataset workflow for local testing.

## Data Contract

Use these status/value conventions consistently:

```ts
export const DATASET_STATUS = ["ready", "archived"] as const;
export const DATASET_IMPORT_STATUS = ["completed", "rejected"] as const;
export const ANNOTATION_ASSIGNMENT_STATUS = ["assigned", "in_review", "completed"] as const;

export type DatasetDisplayConfig = {
  listFields: string[];
  detailFields: string[];
};

export type DatasetMetricScale = {
  values: string[];
};

export type DatasetMetricInput = {
  key: string;
  label: string;
  description?: string;
  scale: DatasetMetricScale;
  required: boolean;
  sortOrder: number;
};
```

Default safety/compliance metrics for the create screen:

```ts
export const SAFETY_COMPLIANCE_DEFAULT_METRICS: DatasetMetricInput[] = [
  {
    key: "policy_violation",
    label: "Vi phạm chính sách",
    description: "Nội dung có vi phạm chính sách an toàn - tuân thủ hay không.",
    scale: { values: ["Failed", "Pass"] },
    required: true,
    sortOrder: 0,
  },
  {
    key: "implicit_risk",
    label: "Mức độ ẩn ý",
    description: "Nội dung có rủi ro ẩn ý cần chặn hoặc đánh dấu hay không.",
    scale: { values: ["Failed", "Pass"] },
    required: true,
    sortOrder: 1,
  },
  {
    key: "guideline_clarity",
    label: "Độ rõ của guideline",
    description: "Guideline áp dụng có đủ rõ để quyết định nhãn hay không.",
    scale: { values: ["Failed", "Pass"] },
    required: true,
    sortOrder: 2,
  },
];
```

---

### Task 1: Dataset Helper Tests

**Files:**
- Create: `tests/datasets/run.ts`
- Create: `tests/datasets/import-validation.test.ts`
- Create: `tests/datasets/assignment.test.ts`
- Create: `tests/datasets/metrics.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add the dataset test command**

Add this script to `package.json`:

```json
"test:datasets": "tsx tests/datasets/run.ts"
```

- [ ] **Step 2: Create the test runner**

Create `tests/datasets/run.ts`:

```ts
import "./import-validation.test";
import "./assignment.test";
import "./metrics.test";

console.log("dataset helper tests passed");
```

- [ ] **Step 3: Write import validation tests before helpers exist**

Create `tests/datasets/import-validation.test.ts`:

```ts
import assert from "node:assert/strict";
import {
  computeRequiredAppendFields,
  flattenRecordPaths,
  getPathValue,
  parseDatasetRows,
  projectFields,
  validateAppendRows,
  validateDisplayFields,
} from "../../src/lib/datasets/import-validation";

const rows = parseDatasetRows(
  JSON.stringify([
    { id: "1", input: "A", label: { decision: "block" }, meta: { policy: "safety" } },
    { id: "2", input: "B", label: { decision: "allow" }, meta: { policy: "compliance" } },
  ]),
);

assert.equal(rows.length, 2);
assert.deepEqual(flattenRecordPaths(rows[0]).map((field) => field.path).sort(), [
  "id",
  "input",
  "label.decision",
  "meta.policy",
]);
assert.equal(getPathValue(rows[0], "label.decision"), "block");
assert.deepEqual(projectFields(rows[0], ["input", "label.decision"]), {
  input: "A",
  "label.decision": "block",
});
assert.deepEqual(computeRequiredAppendFields(["input"], ["label.decision", "meta.policy"]), [
  "input",
  "label.decision",
  "meta.policy",
]);

assert.deepEqual(validateDisplayFields(rows, ["input"], ["label.decision"]), {
  ok: true,
  missingFields: [],
});

assert.deepEqual(validateAppendRows([{ input: "C", label: { decision: "block" }, extra: true }], ["input", "label.decision"]), {
  ok: true,
  missingFields: [],
});

assert.deepEqual(validateAppendRows([{ input: "C" }, { label: { decision: "block" } }], ["input", "label.decision"]), {
  ok: false,
  missingFields: [
    { path: "input", missingRowIndexes: [1], missingCount: 1 },
    { path: "label.decision", missingRowIndexes: [0], missingCount: 1 },
  ],
});

assert.throws(() => parseDatasetRows("{\"input\":\"not-array\"}"), /JSON array/);
assert.throws(() => parseDatasetRows("[]"), /empty/);
assert.throws(() => parseDatasetRows("{"), /Invalid JSON/);
```

- [ ] **Step 4: Write assignment tests before planner exists**

Create `tests/datasets/assignment.test.ts`:

```ts
import assert from "node:assert/strict";
import { planBalancedAssignments } from "../../src/lib/datasets/assignment";

const plan = planBalancedAssignments({
  rowIds: ["r1", "r2", "r3"],
  annotatorIds: ["a1", "a2", "a3"],
  metricIds: ["m1", "m2"],
  targetOverlap: 2,
  existingAssignments: [
    { rowId: "r1", annotatorId: "a1", metricKey: "m1,m2", status: "completed" },
  ],
});

assert.equal(plan.ok, true);
if (plan.ok) {
  assert.deepEqual(plan.assignments, [
    { rowId: "r1", annotatorId: "a2", metricIds: ["m1", "m2"] },
    { rowId: "r2", annotatorId: "a3", metricIds: ["m1", "m2"] },
    { rowId: "r2", annotatorId: "a1", metricIds: ["m1", "m2"] },
    { rowId: "r3", annotatorId: "a2", metricIds: ["m1", "m2"] },
    { rowId: "r3", annotatorId: "a3", metricIds: ["m1", "m2"] },
  ]);
  assert.deepEqual(plan.skippedRowIds, []);
}

assert.deepEqual(
  planBalancedAssignments({
    rowIds: ["r1"],
    annotatorIds: ["a1"],
    metricIds: ["m1"],
    targetOverlap: 2,
    existingAssignments: [],
  }),
  { ok: false, reason: "NOT_ENOUGH_ANNOTATORS" },
);

const alreadyComplete = planBalancedAssignments({
  rowIds: ["r1"],
  annotatorIds: ["a1", "a2"],
  metricIds: ["m1"],
  targetOverlap: 2,
  existingAssignments: [
    { rowId: "r1", annotatorId: "a1", metricKey: "m1", status: "completed" },
    { rowId: "r1", annotatorId: "a2", metricKey: "m1", status: "assigned" },
  ],
});

assert.equal(alreadyComplete.ok, true);
if (alreadyComplete.ok) {
  assert.deepEqual(alreadyComplete.assignments, []);
  assert.deepEqual(alreadyComplete.skippedRowIds, ["r1"]);
}
```

- [ ] **Step 5: Write metric validation tests before helpers exist**

Create `tests/datasets/metrics.test.ts`:

```ts
import assert from "node:assert/strict";
import { validateMetricConfig, validateMetricSubmission } from "../../src/lib/datasets/metrics";

const config = validateMetricConfig([
  {
    key: "policy_violation",
    label: "Vi phạm chính sách",
    scale: { values: ["Failed", "Pass"] },
    required: true,
    sortOrder: 0,
  },
]);

assert.equal(config.ok, true);

assert.deepEqual(
  validateMetricSubmission({
    assignedMetricIds: ["policy_violation"],
    metrics: [{ id: "policy_violation", scale: { values: ["Failed", "Pass"] } }],
    values: { policy_violation: "Pass" },
  }),
  { ok: true },
);

assert.deepEqual(
  validateMetricSubmission({
    assignedMetricIds: ["policy_violation"],
    metrics: [{ id: "policy_violation", scale: { values: ["Failed", "Pass"] } }],
    values: { policy_violation: "5" },
  }),
  { ok: false, reason: "INVALID_METRIC_VALUE", metricId: "policy_violation" },
);

assert.deepEqual(
  validateMetricSubmission({
    assignedMetricIds: ["policy_violation"],
    metrics: [{ id: "policy_violation", scale: { values: ["Failed", "Pass"] } }],
    values: { unassigned_metric: "Pass" },
  }),
  { ok: false, reason: "UNASSIGNED_METRIC", metricId: "unassigned_metric" },
);
```

- [ ] **Step 6: Verify tests fail for missing modules**

Run:

```bash
pnpm test:datasets
```

Expected: fails with a TypeScript module resolution error for `src/lib/datasets/*`.

- [ ] **Step 7: Commit the failing tests**

```bash
git add package.json tests/datasets
git commit -m "test: add dataset workflow helper coverage"
```

---

### Task 2: Dataset Helper Implementation

**Files:**
- Create: `src/lib/datasets/json-paths.ts`
- Create: `src/lib/datasets/import-validation.ts`
- Create: `src/lib/datasets/metrics.ts`
- Create: `src/lib/datasets/assignment.ts`
- Create: `src/lib/datasets/aggregation.ts`
- Test: `tests/datasets/*.test.ts`

- [ ] **Step 1: Create JSON path helpers**

Create `src/lib/datasets/json-paths.ts`:

```ts
export type JsonRecord = Record<string, unknown>;
export type JsonFieldType = "string" | "number" | "boolean" | "null" | "array" | "object";

export interface JsonFieldDescriptor {
  path: string;
  type: JsonFieldType;
  sample: unknown;
}

export function getJsonValueType(value: unknown): JsonFieldType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const valueType = typeof value;
  if (valueType === "string" || valueType === "number" || valueType === "boolean") return valueType;
  return "object";
}

export function flattenRecordPaths(record: JsonRecord, prefix = ""): JsonFieldDescriptor[] {
  return Object.entries(record).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = flattenRecordPaths(value as JsonRecord, path);
      return nested.length ? nested : [{ path, type: "object" as const, sample: value }];
    }
    return [{ path, type: getJsonValueType(value), sample: value }];
  });
}

export function getPathValue(record: JsonRecord, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[key];
  }, record);
}

export function hasPath(record: JsonRecord, path: string): boolean {
  return getPathValue(record, path) !== undefined;
}

export function projectFields(record: JsonRecord, paths: string[]): Record<string, unknown> {
  return Object.fromEntries(paths.map((path) => [path, getPathValue(record, path)]));
}

export function buildSchemaFingerprint(rows: JsonRecord[]): JsonFieldDescriptor[] {
  const byPath = new Map<string, JsonFieldDescriptor>();
  for (const row of rows.slice(0, 50)) {
    for (const field of flattenRecordPaths(row)) {
      if (!byPath.has(field.path)) byPath.set(field.path, field);
    }
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}
```

- [ ] **Step 2: Create import validation helpers**

Create `src/lib/datasets/import-validation.ts`:

```ts
import {
  buildSchemaFingerprint,
  flattenRecordPaths,
  getPathValue,
  hasPath,
  projectFields,
  type JsonFieldDescriptor,
  type JsonRecord,
} from "./json-paths";

export { flattenRecordPaths, getPathValue, projectFields };
export type { JsonFieldDescriptor, JsonRecord };

export interface MissingFieldReport {
  path: string;
  missingRowIndexes: number[];
  missingCount: number;
}

export function parseDatasetRows(rawText: string): JsonRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("Invalid JSON");
  }
  if (!Array.isArray(parsed)) throw new Error("Dataset upload must be a JSON array");
  if (parsed.length === 0) throw new Error("Dataset upload is empty");
  if (!parsed.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
    throw new Error("Dataset rows must be JSON objects");
  }
  return parsed as JsonRecord[];
}

export function inspectDatasetRows(rows: JsonRecord[]) {
  return {
    rowCount: rows.length,
    fields: buildSchemaFingerprint(rows),
    sampleRows: rows.slice(0, 5),
  };
}

export function computeRequiredAppendFields(listFields: string[], detailFields: string[]): string[] {
  return Array.from(new Set([...listFields, ...detailFields]));
}

export function validateDisplayFields(rows: JsonRecord[], listFields: string[], detailFields: string[]) {
  const requiredFields = computeRequiredAppendFields(listFields, detailFields);
  return validateAppendRows(rows, requiredFields);
}

export function validateAppendRows(rows: JsonRecord[], requiredFields: string[]) {
  const missingFields: MissingFieldReport[] = requiredFields
    .map((path) => {
      const missingRowIndexes = rows.flatMap((row, index) => (hasPath(row, path) ? [] : [index]));
      return { path, missingRowIndexes, missingCount: missingRowIndexes.length };
    })
    .filter((field) => field.missingCount > 0);

  return { ok: missingFields.length === 0, missingFields };
}
```

- [ ] **Step 3: Create metric helpers**

Create `src/lib/datasets/metrics.ts`:

```ts
export interface MetricConfigInput {
  key: string;
  label: string;
  description?: string;
  scale: { values: string[] };
  required: boolean;
  sortOrder: number;
}

export function validateMetricConfig(metrics: MetricConfigInput[]) {
  const keys = new Set<string>();
  for (const metric of metrics) {
    if (!metric.key.trim()) return { ok: false as const, reason: "EMPTY_METRIC_KEY" as const };
    if (keys.has(metric.key)) return { ok: false as const, reason: "DUPLICATE_METRIC_KEY" as const, key: metric.key };
    if (!metric.label.trim()) return { ok: false as const, reason: "EMPTY_METRIC_LABEL" as const, key: metric.key };
    if (metric.scale.values.length < 2) return { ok: false as const, reason: "METRIC_SCALE_TOO_SHORT" as const, key: metric.key };
    keys.add(metric.key);
  }
  return { ok: true as const };
}

export function validateMetricSubmission(input: {
  assignedMetricIds: string[];
  metrics: Array<{ id: string; scale: { values: string[] } }>;
  values: Record<string, string>;
}) {
  const assigned = new Set(input.assignedMetricIds);
  const metrics = new Map(input.metrics.map((metric) => [metric.id, metric]));

  for (const metricId of Object.keys(input.values)) {
    if (!assigned.has(metricId)) return { ok: false as const, reason: "UNASSIGNED_METRIC" as const, metricId };
  }
  for (const metricId of input.assignedMetricIds) {
    const value = input.values[metricId];
    const metric = metrics.get(metricId);
    if (!metric) return { ok: false as const, reason: "UNKNOWN_METRIC" as const, metricId };
    if (!metric.scale.values.includes(value)) {
      return { ok: false as const, reason: "INVALID_METRIC_VALUE" as const, metricId };
    }
  }
  return { ok: true as const };
}
```

- [ ] **Step 4: Create balanced assignment planner**

Create `src/lib/datasets/assignment.ts`:

```ts
export interface ExistingAssignment {
  rowId: string;
  annotatorId: string;
  metricKey: string;
  status: "assigned" | "in_review" | "completed";
}

export interface PlannedAssignment {
  rowId: string;
  annotatorId: string;
  metricIds: string[];
}

export function buildMetricKey(metricIds: string[]): string {
  return [...metricIds].sort().join(",");
}

export function planBalancedAssignments(input: {
  rowIds: string[];
  annotatorIds: string[];
  metricIds: string[];
  targetOverlap: number;
  existingAssignments: ExistingAssignment[];
}): { ok: true; assignments: PlannedAssignment[]; skippedRowIds: string[] } | { ok: false; reason: "NOT_ENOUGH_ANNOTATORS" } {
  if (input.annotatorIds.length < input.targetOverlap) return { ok: false, reason: "NOT_ENOUGH_ANNOTATORS" };

  const metricKey = buildMetricKey(input.metricIds);
  const currentRunLoad = new Map(input.annotatorIds.map((annotatorId) => [annotatorId, 0]));
  const assignments: PlannedAssignment[] = [];
  const skippedRowIds: string[] = [];

  for (const rowId of input.rowIds) {
    const existingForRow = input.existingAssignments.filter(
      (assignment) => assignment.rowId === rowId && assignment.metricKey === metricKey,
    );
    const assignedAnnotators = new Set(existingForRow.map((assignment) => assignment.annotatorId));
    const missing = input.targetOverlap - existingForRow.length;

    if (missing <= 0) {
      skippedRowIds.push(rowId);
      continue;
    }

    for (let index = 0; index < missing; index += 1) {
      const nextAnnotator = input.annotatorIds
        .filter((annotatorId) => !assignedAnnotators.has(annotatorId))
        .sort((a, b) => (currentRunLoad.get(a) ?? 0) - (currentRunLoad.get(b) ?? 0) || a.localeCompare(b))[0];

      if (!nextAnnotator) break;
      assignments.push({ rowId, annotatorId: nextAnnotator, metricIds: input.metricIds });
      assignedAnnotators.add(nextAnnotator);
      currentRunLoad.set(nextAnnotator, (currentRunLoad.get(nextAnnotator) ?? 0) + 1);
    }
  }

  return { ok: true, assignments, skippedRowIds };
}
```

- [ ] **Step 5: Create aggregation helpers**

Create `src/lib/datasets/aggregation.ts`:

```ts
export interface RowAssignmentForAggregation {
  rowId: string;
  annotatorId: string;
  annotatorName: string | null;
  annotatorImage: string | null;
  status: "assigned" | "in_review" | "completed";
}

export interface MetricResultForAggregation {
  rowId: string;
  metricId: string;
  value: string;
}

export function computeRowProgress(assignments: RowAssignmentForAggregation[], targetOverlap: number) {
  const completedAssignments = assignments.filter((assignment) => assignment.status === "completed");
  const completedCount = completedAssignments.length;
  return {
    completedCount,
    annotatedBy: completedAssignments.map((assignment) => ({
      id: assignment.annotatorId,
      name: assignment.annotatorName,
      image: assignment.annotatorImage,
    })),
    overlapLabel: `${completedCount}/${targetOverlap}`,
    missingCount: Math.max(targetOverlap - completedCount, 0),
  };
}

export function computeAgreement(results: MetricResultForAggregation[]): number | null {
  const byMetric = new Map<string, string[]>();
  for (const result of results) {
    byMetric.set(result.metricId, [...(byMetric.get(result.metricId) ?? []), result.value]);
  }

  const metricAgreements = [...byMetric.values()]
    .filter((values) => values.length >= 2)
    .map((values) => {
      const counts = new Map<string, number>();
      for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
      return Math.max(...counts.values()) / values.length;
    });

  if (metricAgreements.length === 0) return null;
  return Math.round((metricAgreements.reduce((sum, value) => sum + value, 0) / metricAgreements.length) * 100);
}
```

- [ ] **Step 6: Run helper tests**

Run:

```bash
pnpm test:datasets
```

Expected: `dataset helper tests passed`.

- [ ] **Step 7: Commit helper implementation**

```bash
git add src/lib/datasets tests/datasets package.json
git commit -m "feat: add dataset workflow helpers"
```

---

### Task 3: Dataset Database Schema

**Files:**
- Create: `src/db/datasets.ts`
- Create: `src/db/datasets.sqlite.ts`
- Create: `migrations/0013_dataset_annotation_workflow.sql`
- Modify: `src/db/client.ts`
- Modify: `drizzle.config.ts`
- Modify: `scripts/seed-local.ts`

- [ ] **Step 1: Create PostgreSQL Drizzle schema**

Create `src/db/datasets.ts` with these tables and indexes:

```ts
import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";
import { profiles } from "./schema";

export const datasets = pgTable("datasets", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  status: text("status").notNull().default("ready"),
  schemaFingerprint: jsonb("schema_fingerprint").notNull().$type<Array<{ path: string; type: string; sample: unknown }>>(),
  displayConfig: jsonb("display_config").notNull().$type<{ listFields: string[]; detailFields: string[] }>(),
  requiredAppendFields: jsonb("required_append_fields").notNull().$type<string[]>(),
  createdBy: text("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const datasetImports = pgTable("dataset_imports", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  datasetId: text("dataset_id").notNull().references(() => datasets.id, { onDelete: "cascade" }),
  sourceFilename: text("source_filename").notNull(),
  status: text("status").notNull(),
  rowCount: integer("row_count").notNull().default(0),
  missingFieldsReport: jsonb("missing_fields_report").$type<Array<{ path: string; missingRowIndexes: number[]; missingCount: number }>>(),
  createdBy: text("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const datasetRows = pgTable("dataset_rows", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  datasetId: text("dataset_id").notNull().references(() => datasets.id, { onDelete: "cascade" }),
  importId: text("import_id").notNull().references(() => datasetImports.id, { onDelete: "cascade" }),
  internalRowId: integer("internal_row_id").notNull(),
  rawJson: jsonb("raw_json").notNull().$type<Record<string, unknown>>(),
  sourceId: text("source_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  datasetRowUnique: uniqueIndex("dataset_rows_dataset_internal_row_unique").on(table.datasetId, table.internalRowId),
  datasetIdx: index("dataset_rows_dataset_idx").on(table.datasetId),
}));

export const annotationMetrics = pgTable("annotation_metrics", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  datasetId: text("dataset_id").notNull().references(() => datasets.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  label: text("label").notNull(),
  description: text("description"),
  scaleJson: jsonb("scale_json").notNull().$type<{ values: string[] }>(),
  required: boolean("required").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  datasetMetricKeyUnique: uniqueIndex("annotation_metrics_dataset_key_unique").on(table.datasetId, table.key),
}));

export const annotationAssignmentRuns = pgTable("annotation_assignment_runs", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  datasetId: text("dataset_id").notNull().references(() => datasets.id, { onDelete: "cascade" }),
  targetOverlap: integer("target_overlap").notNull(),
  metricIds: jsonb("metric_ids").notNull().$type<string[]>(),
  scope: text("scope").notNull(),
  createdBy: text("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const annotationAssignments = pgTable("annotation_assignments", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  assignmentRunId: text("assignment_run_id").notNull().references(() => annotationAssignmentRuns.id, { onDelete: "cascade" }),
  datasetId: text("dataset_id").notNull().references(() => datasets.id, { onDelete: "cascade" }),
  rowId: text("row_id").notNull().references(() => datasetRows.id, { onDelete: "cascade" }),
  annotatorId: text("annotator_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  metricIds: jsonb("metric_ids").notNull().$type<string[]>(),
  metricKey: text("metric_key").notNull(),
  targetOverlap: integer("target_overlap").notNull(),
  status: text("status").notNull().default("assigned"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  rowAnnotatorMetricUnique: uniqueIndex("annotation_assignments_row_annotator_metric_unique").on(table.rowId, table.annotatorId, table.metricKey),
  datasetIdx: index("annotation_assignments_dataset_idx").on(table.datasetId),
  annotatorIdx: index("annotation_assignments_annotator_idx").on(table.annotatorId),
}));

export const annotationResults = pgTable("annotation_results", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  assignmentId: text("assignment_id").notNull().references(() => annotationAssignments.id, { onDelete: "cascade" }),
  rowId: text("row_id").notNull().references(() => datasetRows.id, { onDelete: "cascade" }),
  annotatorId: text("annotator_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  metricId: text("metric_id").notNull().references(() => annotationMetrics.id, { onDelete: "cascade" }),
  value: text("value").notNull(),
  note: text("note"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  assignmentMetricUnique: uniqueIndex("annotation_results_assignment_metric_unique").on(table.assignmentId, table.metricId),
  rowMetricIdx: index("annotation_results_row_metric_idx").on(table.rowId, table.metricId),
}));

export const datasetUpdatedAtTrigger = sql``;
```

- [ ] **Step 2: Create SQLite Drizzle schema**

Create `src/db/datasets.sqlite.ts` mirroring the Postgres schema with `sqliteTable`, `text`, `integer`, `uniqueIndex`, and JSON fields stored as `text(..., { mode: "json" })`.

- [ ] **Step 3: Add migration SQL**

Create `migrations/0013_dataset_annotation_workflow.sql` with `CREATE TABLE IF NOT EXISTS` statements matching Task 3 Step 1 and these indexes:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS dataset_rows_dataset_internal_row_unique ON dataset_rows(dataset_id, internal_row_id);
CREATE INDEX IF NOT EXISTS dataset_rows_dataset_idx ON dataset_rows(dataset_id);
CREATE UNIQUE INDEX IF NOT EXISTS annotation_metrics_dataset_key_unique ON annotation_metrics(dataset_id, key);
CREATE UNIQUE INDEX IF NOT EXISTS annotation_assignments_row_annotator_metric_unique ON annotation_assignments(row_id, annotator_id, metric_key);
CREATE INDEX IF NOT EXISTS annotation_assignments_dataset_idx ON annotation_assignments(dataset_id);
CREATE INDEX IF NOT EXISTS annotation_assignments_annotator_idx ON annotation_assignments(annotator_id);
CREATE UNIQUE INDEX IF NOT EXISTS annotation_results_assignment_metric_unique ON annotation_results(assignment_id, metric_id);
CREATE INDEX IF NOT EXISTS annotation_results_row_metric_idx ON annotation_results(row_id, metric_id);
```

- [ ] **Step 4: Wire schemas into Drizzle**

Modify `src/db/client.ts`:

```ts
import * as datasetsSchema from "./datasets";
import * as datasetsSqlite from "./datasets.sqlite";
```

Include the new modules in the schema bundles:

```ts
const allSqliteSchema = { ...schemaSqlite, ...reviewsSqlite, ...timeEventsSqlite, ...compensationSurveySqlite, ...datasetsSqlite };
const allSchema = { ...schema, ...reviewsSchema, ...timeEventsSchema, ...compensationSurveySchema, ...datasetsSchema };
```

- [ ] **Step 5: Wire schemas into Drizzle config**

Modify `drizzle.config.ts` schema arrays:

```ts
schema: [
  "./src/db/schema.sqlite.ts",
  "./src/db/reviews.sqlite.ts",
  "./src/db/time-events.sqlite.ts",
  "./src/db/compensation-survey.sqlite.ts",
  "./src/db/datasets.sqlite.ts",
],
```

```ts
schema: [
  "./src/db/schema.ts",
  "./src/db/reviews.ts",
  "./src/db/time-events.ts",
  "./src/db/compensation-survey.ts",
  "./src/db/datasets.ts",
],
```

- [ ] **Step 6: Add local SQLite table creation**

Modify `scripts/seed-local.ts` and append `CREATE TABLE IF NOT EXISTS` statements for all dataset tables. Use `TEXT` for JSON fields, `INTEGER` for timestamps, and the same unique indexes from the migration.

- [ ] **Step 7: Verify schema compiles**

Run:

```bash
pnpm typecheck
pnpm test:datasets
```

Expected: both pass.

- [ ] **Step 8: Commit database schema**

```bash
git add src/db/datasets.ts src/db/datasets.sqlite.ts src/db/client.ts drizzle.config.ts scripts/seed-local.ts migrations/0013_dataset_annotation_workflow.sql
git commit -m "feat: add dataset annotation schema"
```

---

### Task 4: Admin Dataset APIs

**Files:**
- Create: `src/app/api/datasets/inspect/route.ts`
- Create: `src/app/api/datasets/route.ts`
- Create: `src/app/api/datasets/[id]/route.ts`
- Create: `src/app/api/datasets/[id]/rows/route.ts`

- [ ] **Step 1: Implement inspect API**

Create `src/app/api/datasets/inspect/route.ts`. The endpoint is admin-only and accepts:

```ts
type InspectRequest = {
  filename: string;
  content: string;
};
```

Response:

```ts
type InspectResponse = {
  filename: string;
  rowCount: number;
  fields: Array<{ path: string; type: string; sample: unknown }>;
  sampleRows: Record<string, unknown>[];
};
```

Use `requireAdmin`, `parseDatasetRows`, and `inspectDatasetRows`. Return HTTP 400 with `{ error: "INVALID_DATASET_JSON", message }` for invalid JSON, non-array JSON, empty arrays, or non-object rows.

- [ ] **Step 2: Implement dataset create/list API**

Create `src/app/api/datasets/route.ts` with:

```ts
const createDatasetSchema = z.object({
  name: z.string().min(1),
  domain: z.string().min(1),
  sourceFilename: z.string().min(1),
  rows: z.array(z.record(z.unknown())).min(1),
  listFields: z.array(z.string()).min(1),
  detailFields: z.array(z.string()).min(1),
  metrics: z.array(z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    description: z.string().optional(),
    scale: z.object({ values: z.array(z.string().min(1)).min(2) }),
    required: z.boolean().default(true),
    sortOrder: z.number().int().default(0),
  })).min(1),
});
```

`POST` behavior:

- Validate display fields exist in uploaded rows.
- Validate metrics.
- Insert dataset, first import, rows, and metrics in one transaction.
- Store `requiredAppendFields = computeRequiredAppendFields(listFields, detailFields)`.
- Return `{ datasetId }`.

`GET` behavior:

- Return datasets ordered by `created_at desc` with `rowCount`, `metricCount`, and latest import filename.

- [ ] **Step 3: Implement dataset detail API**

Create `src/app/api/datasets/[id]/route.ts`. `GET` returns:

```ts
{
  dataset: {
    id: string;
    name: string;
    domain: string;
    status: string;
    displayConfig: { listFields: string[]; detailFields: string[] };
    requiredAppendFields: string[];
    schemaFingerprint: Array<{ path: string; type: string; sample: unknown }>;
  };
  metrics: Array<{ id: string; key: string; label: string; description: string | null; scale: { values: string[] }; required: boolean; sortOrder: number }>;
  imports: Array<{ id: string; sourceFilename: string; status: string; rowCount: number; createdAt: string }>;
}
```

- [ ] **Step 4: Implement row list aggregation API**

Create `src/app/api/datasets/[id]/rows/route.ts`. `GET` accepts `page`, `pageSize`, and optional `q`. Return configured list-field projections only:

```ts
{
  rows: Array<{
    id: string;
    internalRowId: number;
    listFields: Record<string, unknown>;
    completedCount: number;
    annotatedBy: Array<{ id: string; name: string | null; image: string | null }>;
    agreement: number | null;
    overlapLabel: string;
    missingCount: number;
  }>;
  total: number;
}
```

- [ ] **Step 5: Verify API typecheck and helper tests**

Run:

```bash
pnpm typecheck
pnpm test:datasets
```

Expected: both pass.

- [ ] **Step 6: Commit admin dataset APIs**

```bash
git add src/app/api/datasets src/lib/datasets
git commit -m "feat: add admin dataset APIs"
```

---

### Task 5: Append Import APIs

**Files:**
- Create: `src/app/api/datasets/[id]/imports/inspect/route.ts`
- Create: `src/app/api/datasets/[id]/imports/route.ts`

- [ ] **Step 1: Implement append inspect API**

Create `src/app/api/datasets/[id]/imports/inspect/route.ts`. The endpoint is admin-only and accepts `{ filename: string; content: string }`. Behavior:

- Parse uploaded JSON array.
- Load `datasets.required_append_fields`.
- Call `validateAppendRows(rows, requiredAppendFields)`.
- Return `{ ok: true, rowCount, extraFields }` when all required fields are present.
- Return HTTP 400 with `{ error: "MISSING_REQUIRED_FIELDS", missingFields }` when a selected list/detail field is absent from any row.
- Extra fields are allowed and included only for admin visibility.

- [ ] **Step 2: Implement append import API**

Create `src/app/api/datasets/[id]/imports/route.ts`. The endpoint repeats validation before writing. Behavior:

- Insert `dataset_imports` with `status = "completed"`.
- Append `dataset_rows` with `internal_row_id` starting after the current max for the dataset.
- Preserve full raw JSON for every row.
- Return `{ importId, insertedRows }`.

- [ ] **Step 3: Add append coverage to helper tests**

Extend `tests/datasets/import-validation.test.ts` with:

```ts
assert.deepEqual(
  validateAppendRows([{ input: "new", label: { decision: "block" }, unused: "allowed" }], ["input", "label.decision"]),
  { ok: true, missingFields: [] },
);
```

- [ ] **Step 4: Verify append APIs compile**

Run:

```bash
pnpm typecheck
pnpm test:datasets
```

Expected: both pass.

- [ ] **Step 5: Commit append APIs**

```bash
git add src/app/api/datasets/[id]/imports tests/datasets/import-validation.test.ts
git commit -m "feat: add dataset append import APIs"
```

---

### Task 6: Assignment and Annotator Task APIs

**Files:**
- Create: `src/app/api/datasets/[id]/assign/route.ts`
- Create: `src/app/api/annotator/tasks/route.ts`
- Create: `src/app/api/annotator/tasks/[id]/route.ts`
- Create: `src/app/api/annotator/tasks/[id]/submit/route.ts`

- [ ] **Step 1: Implement admin assign API**

Create `src/app/api/datasets/[id]/assign/route.ts` with request shape:

```ts
const assignRequestSchema = z.object({
  scope: z.union([
    z.object({ type: z.literal("all") }),
    z.object({ type: z.literal("selected"), rowIds: z.array(z.string()).min(1) }),
  ]),
  targetOverlap: z.number().int().min(1).max(5),
  metricIds: z.array(z.string()).min(1),
  annotatorIds: z.array(z.string()).min(1),
});
```

Behavior:

- Require admin.
- Validate metric ids belong to the dataset.
- Validate selected annotators are active `expert_profiles.status = "active"`.
- Reject with HTTP 400 `{ error: "NOT_ENOUGH_ANNOTATORS" }` if selected active annotators are fewer than `targetOverlap`.
- Load existing annotation assignments for the dataset and selected metric set.
- Use `planBalancedAssignments`.
- Insert one assignment run and planned assignments in a transaction.
- Return `{ assignmentRunId, createdAssignments, skippedRows }`.

- [ ] **Step 2: Implement annotator task list API**

Create `src/app/api/annotator/tasks/route.ts`. Use `requireExpert`. Return current user's assignments ordered by `assigned_at`:

```ts
{
  tasks: Array<{
    id: string;
    datasetId: string;
    datasetName: string;
    internalRowId: number;
    status: "assigned" | "in_review" | "completed";
    assignedAt: string;
    listFields: Record<string, unknown>;
    metricLabels: string[];
  }>;
}
```

- [ ] **Step 3: Implement annotator task detail API**

Create `src/app/api/annotator/tasks/[id]/route.ts`. Use `requireExpert` and enforce ownership by `annotation_assignments.annotator_id`. Return only selected detail fields and assigned metrics:

```ts
{
  task: {
    id: string;
    status: string;
    datasetName: string;
    internalRowId: number;
    detailFields: Record<string, unknown>;
    metrics: Array<{ id: string; key: string; label: string; description: string | null; scale: { values: string[] }; required: boolean }>;
    existingValues: Record<string, { value: string; note: string | null }>;
  };
}
```

- [ ] **Step 4: Implement annotator submit API**

Create `src/app/api/annotator/tasks/[id]/submit/route.ts`. Behavior:

- Require expert and ownership.
- Accept `{ values: Record<string, string>; notes?: Record<string, string> }`.
- Load assigned metric ids and metric scales.
- Call `validateMetricSubmission`.
- Upsert `annotation_results` per metric.
- Mark assignment `completed` only when every assigned metric has a valid submitted value.
- Return `{ ok: true, status: "completed" }`.

- [ ] **Step 5: Verify APIs**

Run:

```bash
pnpm typecheck
pnpm test:datasets
```

Expected: both pass.

- [ ] **Step 6: Commit assignment APIs**

```bash
git add src/app/api/datasets/[id]/assign src/app/api/annotator
git commit -m "feat: add dataset assignment APIs"
```

---

### Task 7: Admin Dataset UI

**Files:**
- Create: `src/components/admin/dataset-field-selector.tsx`
- Create: `src/components/admin/dataset-metrics-editor.tsx`
- Create: `src/components/admin/dataset-row-table.tsx`
- Create: `src/components/admin/dataset-append-import-panel.tsx`
- Create: `src/components/admin/dataset-assign-modal.tsx`
- Create: `src/components/admin/annotator-avatar-stack.tsx`
- Create: `src/components/admin/overlap-badge.tsx`
- Create: `src/components/admin/agreement-badge.tsx`
- Create: `src/components/admin/json-field-value.tsx`
- Create: `src/app/admin/datasets/page.tsx`
- Create: `src/app/admin/datasets/new/page.tsx`
- Create: `src/app/admin/datasets/[id]/page.tsx`
- Modify: `src/components/app-sidebar.tsx`
- Modify: `src/components/app-mobile-nav.tsx`

- [ ] **Step 1: Build JSON field renderer**

Create `src/components/admin/json-field-value.tsx`. Render primitive values inline; render objects/arrays as compact one-line JSON with truncation.

- [ ] **Step 2: Build field selector**

Create `src/components/admin/dataset-field-selector.tsx` with props:

```ts
export interface DatasetFieldSelectorProps {
  fields: Array<{ path: string; type: string; sample: unknown }>;
  listFields: string[];
  detailFields: string[];
  onListFieldsChange: (fields: string[]) => void;
  onDetailFieldsChange: (fields: string[]) => void;
}
```

Use checkboxes. Copy must say only: `Hiển thị trên list` and `Hiển thị trên detail`.

- [ ] **Step 3: Build metric editor**

Create `src/components/admin/dataset-metrics-editor.tsx`. Start with the three safety/compliance defaults and scale values `Failed`, `Pass`. Allow admin to add/remove metrics and edit label/description/key. Do not show a 1-5 numeric scale in this workflow.

- [ ] **Step 4: Build row table components**

Create:

- `src/components/admin/annotator-avatar-stack.tsx`
- `src/components/admin/overlap-badge.tsx`
- `src/components/admin/agreement-badge.tsx`
- `src/components/admin/dataset-row-table.tsx`

`DatasetRowTable` must support row checkbox selection, configured list field columns, completed count, annotator initials, agreement, overlap badge, and selected row ids.

- [ ] **Step 5: Build append import panel**

Create `src/components/admin/dataset-append-import-panel.tsx`. It should:

- Read a `.json` file as text in the browser.
- Call `/api/datasets/${datasetId}/imports/inspect`.
- Show success when extra fields are present but required fields pass.
- Show missing field paths and missing counts when blocked.
- Call `/api/datasets/${datasetId}/imports` only after inspect succeeds.

- [ ] **Step 6: Build assign modal**

Create `src/components/admin/dataset-assign-modal.tsx`. It should:

- Choose scope: selected rows or all dataset.
- Choose target overlap `1..5`.
- Choose metric subset from dataset metrics.
- Choose active annotators loaded from `/api/experts?status=active`.
- Show preview text `X dòng x Y annotator x Z metric`.
- Call `/api/datasets/${datasetId}/assign`.

- [ ] **Step 7: Build admin dataset list**

Create `src/app/admin/datasets/page.tsx`. Follow the table density of `src/app/admin/batches/page.tsx`. Columns: dataset name, domain, row count, metric count, latest import, created date, action.

- [ ] **Step 8: Build new dataset page**

Create `src/app/admin/datasets/new/page.tsx`. Flow:

1. Upload JSON file.
2. Browser reads text and calls `/api/datasets/inspect`.
3. Show row count and field selector.
4. Admin chooses list/detail display fields only.
5. Admin confirms metrics.
6. Page posts `/api/datasets` with rows, selected fields, and metrics.
7. Redirect to `/admin/datasets/${datasetId}`.

- [ ] **Step 9: Build dataset detail page**

Create `src/app/admin/datasets/[id]/page.tsx`. Include dataset summary, import panel, assign modal, and row table. Do not reuse `ArticleTable`.

- [ ] **Step 10: Add admin nav**

Modify sidebar/mobile nav to include:

```ts
{ href: "/admin/datasets", label: "Datasets", icon: TableProperties }
```

Change admin user-management label from `Chuyên gia` to `Annotator`.

- [ ] **Step 11: Verify admin UI**

Run:

```bash
pnpm typecheck
```

Expected: pass.

- [ ] **Step 12: Commit admin dataset UI**

```bash
git add src/components/admin src/app/admin/datasets src/components/app-sidebar.tsx src/components/app-mobile-nav.tsx
git commit -m "feat: add admin dataset workflow UI"
```

---

### Task 8: Annotator UI and Expert Copy Rename

**Files:**
- Create: `src/app/expert/tasks/page.tsx`
- Create: `src/app/expert/tasks/[id]/page.tsx`
- Modify: `src/components/app-sidebar.tsx`
- Modify: `src/components/app-mobile-nav.tsx`
- Modify: `src/components/app-header.tsx`
- Modify: `src/lib/labels.ts`
- Modify: `src/app/admin/experts/page.tsx`
- Modify: `src/app/expert/dashboard/page.tsx`
- Modify: `src/app/expert/profile/page.tsx`
- Modify: `src/app/login/page.tsx`
- Modify: `src/app/signup/page.tsx`
- Modify: `src/app/signup/profile/page.tsx`

- [ ] **Step 1: Centralize role labels**

Modify `src/lib/labels.ts`:

```ts
export const ROLE_LABELS = {
  admin: "Quản trị viên",
  expert: "Người gán nhãn",
} as const;
```

Use `ROLE_LABELS.expert` for UI labels. Keep all DB/auth checks as `"expert"`.

- [ ] **Step 2: Update shell copy**

Modify sidebar, mobile nav, and header:

- Admin nav `/admin/experts`: label `Annotator`.
- Expert nav `/expert/tasks`: label `Task của tôi`.
- Header role chip for internal `expert`: `Người gán nhãn`.

- [ ] **Step 3: Build annotator task list**

Create `src/app/expert/tasks/page.tsx`. Fetch `/api/annotator/tasks`, show assigned dataset rows, status, dataset name, selected list field values, metric labels, and action button.

- [ ] **Step 4: Build annotator task detail**

Create `src/app/expert/tasks/[id]/page.tsx`. Fetch `/api/annotator/tasks/${id}` and render:

- Dataset name and internal row id.
- Selected detail fields only.
- Assigned metric controls only.
- Binary segmented controls using metric scale values such as `Failed` and `Pass`.
- Submit button posting `/api/annotator/tasks/${id}/submit`.

This page must not render SAPO, TLDR, FAQ, claims, or article rubric panels.

- [ ] **Step 5: Rename visible expert copy**

Replace user-facing Vietnamese text in the listed auth/admin/profile pages:

- `Chuyên gia` -> `Annotator` or `Người gán nhãn` depending context.
- `Hồ sơ chuyên gia` -> `Hồ sơ người gán nhãn`.
- `Bài viết của tôi` -> `Task của tôi`.

Do not rename table names, route guard names, TypeScript auth role literals, or environment variable `DEV_ROLE=expert`.

- [ ] **Step 6: Verify annotator UI**

Run:

```bash
pnpm typecheck
```

Expected: pass.

- [ ] **Step 7: Commit annotator UI**

```bash
git add src/app/expert/tasks src/components/app-sidebar.tsx src/components/app-mobile-nav.tsx src/components/app-header.tsx src/lib/labels.ts src/app/admin/experts/page.tsx src/app/expert/dashboard/page.tsx src/app/expert/profile/page.tsx src/app/login/page.tsx src/app/signup/page.tsx src/app/signup/profile/page.tsx
git commit -m "feat: add annotator task UI"
```

---

### Task 9: Local Humanity Dataset Seed

**Files:**
- Create: `scripts/seed-humanity-dataset-local.ts`

- [ ] **Step 1: Create the dataset seed script**

Create `scripts/seed-humanity-dataset-local.ts`. It should:

- Read `/Users/haido/Downloads/humanity_output.json`.
- Take the first 10 rows.
- Create one dataset named `Humanity — An toàn - Tuân thủ`.
- Use list fields `input`, `label.sub_intent`, and `label.policy`.
- Use detail fields `input` and `label`.
- Use the three default safety/compliance metrics with `Failed`/`Pass`.
- Create three active annotators if local seed does not already have enough.
- Assign target overlap `3` to all 10 rows.
- Print dataset and first task URLs.

- [ ] **Step 2: Run local seed**

Run:

```bash
LOCAL_DB_PATH=file:./local.db pnpm exec tsx scripts/seed-humanity-dataset-local.ts
```

Expected output includes:

```text
Dataset: Humanity — An toàn - Tuân thủ
Rows: 10
Assignments: 30
Admin URL: http://localhost:3001/admin/datasets/
Annotator URL: http://localhost:3001/expert/tasks/
```

- [ ] **Step 3: Commit seed script**

```bash
git add scripts/seed-humanity-dataset-local.ts
git commit -m "chore: seed humanity dataset workflow locally"
```

---

### Task 10: End-to-End Verification

**Files:**
- Create: `e2e/dataset-annotation-workflow.spec.ts`

- [ ] **Step 1: Add browser test**

Create `e2e/dataset-annotation-workflow.spec.ts` with coverage for:

- Admin can inspect a JSON array upload and select list/detail fields.
- Admin create screen does not ask for `id`, `input`, or `label` as required key fields.
- Append import with extra fields succeeds.
- Append import missing a selected display field is blocked.
- Assign modal creates overlap assignments.
- Annotator task detail shows selected detail fields and assigned metrics only.
- Annotator task detail does not contain `SAPO`, `TÓM TẮT`, `FAQ`, or `Claims`.
- Submitting `5` for a `Failed`/`Pass` metric is rejected.
- Submitting `Pass` succeeds.

- [ ] **Step 2: Run all verification**

Run:

```bash
pnpm test:datasets
pnpm typecheck
pnpm test:e2e e2e/dataset-annotation-workflow.spec.ts
```

Expected: all pass.

- [ ] **Step 3: Start localhost for manual testing**

Run:

```bash
LOCAL_DB_PATH=file:./local.db DEV_ROLE=expert SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=local-dev-placeholder NEXT_PUBLIC_SUPABASE_ANON_KEY=local-dev-placeholder SUPABASE_SERVICE_ROLE_KEY=local-dev-placeholder NEXT_PUBLIC_APP_URL=http://localhost:3001 pnpm exec next dev --turbopack -H 0.0.0.0 -p 3001
```

Manual URLs:

```text
http://localhost:3001/admin/datasets
http://localhost:3001/expert/tasks
```

- [ ] **Step 4: Final commit**

```bash
git add e2e/dataset-annotation-workflow.spec.ts
git commit -m "test: cover dataset annotation workflow"
```

---

## Parallel Execution Strategy

After Task 1 is committed, dispatch subagents in this order:

- Agent A: Tasks 2 and 3, backend helpers plus schema. This worker owns `src/lib/datasets`, `src/db/datasets*`, `migrations/0013_dataset_annotation_workflow.sql`, `drizzle.config.ts`, `scripts/seed-local.ts`, and dataset helper tests.
- Agent B: Task 4 and Task 5, admin dataset APIs. This worker owns `src/app/api/datasets/**` except assign.
- Agent C: Task 6, assignment and annotator APIs. This worker owns `src/app/api/datasets/[id]/assign/route.ts` and `src/app/api/annotator/**`.
- Agent D: Task 7, admin UI. This worker owns `src/app/admin/datasets/**` and dataset admin components.
- Agent E: Task 8, annotator UI and copy rename. This worker owns `src/app/expert/tasks/**`, shell copy, and auth/profile text.

Integration order:

1. Merge Agent A first because API/UI workers depend on helpers and schema.
2. Merge Agent B and Agent C after schema compiles.
3. Merge Agent D and Agent E after APIs compile.
4. Run Task 9 and Task 10 in the main session.

## Self-Review

- Spec coverage: upload inspect, selected list/detail fields, append extra-field allowance, append missing display-field block, dataset metrics with binary scale, balanced overlap assignment, admin row aggregation, annotator task rendering, and expert-to-annotator UI wording are all mapped to tasks.
- Placeholder scan: this plan uses concrete paths, request shapes, status values, commands, expected outputs, and commit commands.
- Scope control: old batch/article review flow remains intact. Internal auth role stays `expert`; user-facing copy changes to Annotator/Người gán nhãn only.
