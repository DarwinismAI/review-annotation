# Annotator Queue Admin Adjudication Import Jobs Implementation Plan

> **For Herdr delivery:** REQUIRED SUB-SKILL: Use
> `herdr-orchestrator` only after this plan is approved.

**Goal:** Build task-group based annotator queues, full admin row detail with reviewer adjudication, import-job visibility, and bounded dataset loading without losing annotation data.

**Architecture:** Keep `annotation_assignments` as the atomic work item and use existing `annotation_assignment_runs` as the task-group boundary. Add minimal persisted metadata for temporary skip and reviewer adjudication, then expose bounded APIs consumed by annotator and admin pages. Keep mutation routes uncached and transactional; keep list/detail queries paginated and page-bounded.

**Tech Stack:** Next.js App Router, React client pages, TypeScript, Drizzle ORM, Postgres/Supabase migrations, local libsql SQLite schemas, existing UI primitives, `tsx` dataset helper tests, Playwright.

---

## Source Inputs

- Approved spec: `docs/superpowers/specs/2026-07-29-annotator-queue-admin-adjudication-import-jobs-design.md`
- Spec SHA-256: `48c02706c9a2ea87fc88eed711e6270e44342ccd04eeee98be114f160586ba94`
- Repository root: `/Users/haido/expert-review`
- Base SHA at plan time: `30bd9f38b95576f98d7cc3f77a304b8335dc6ac8`

Runtime preflight blocker: this checkout currently has unrelated dirty code changes from earlier work. Do not revert them. Before Herdr starts, either commit those changes separately, or run the approved plan in a clean worktree based on `30bd9f38b95576f98d7cc3f77a304b8335dc6ac8`.

## File Structure

Create or modify these files only where needed:

- `migrations/0022_annotation_queue_adjudication.sql`: Postgres migration for assignment skip metadata, reviewer adjudications, and import job timestamps/error metadata.
- `src/db/datasets.ts`: Drizzle Postgres schema for new assignment/import/adjudication fields.
- `src/db/datasets.sqlite.ts`: Drizzle SQLite schema for local dev parity.
- `scripts/seed-local.ts`: local SQLite table creation parity.
- `scripts/seed-navigation-performance.ts`: performance seed table parity.
- `src/lib/datasets/task-groups.ts`: pure aggregation/random-selection helpers for task groups and temporary skip.
- `src/lib/datasets/adjudication.ts`: pure row-detail/export shaping helpers for reviewer final decisions.
- `tests/datasets/task-groups.test.ts`: helper tests for grouping, counts, random eligibility, skip deprioritization.
- `tests/datasets/adjudication.test.ts`: helper tests proving adjudication does not overwrite annotator votes.
- `tests/datasets/import-jobs.test.ts`: helper tests for import job status projection and active-job blocking payload.
- `tests/datasets/run.ts`: include the new helper tests.
- `src/app/api/annotator/task-groups/route.ts`: grouped task list API.
- `src/app/api/annotator/task-groups/[groupId]/next/route.ts`: random next assignment API.
- `src/app/api/annotator/tasks/[id]/skip/route.ts`: temporary skip API.
- `src/app/api/annotator/tasks/[id]/route.ts`: include group metadata/progress where useful.
- `src/app/api/annotator/tasks/[id]/submit/route.ts`: return next-item hint after transaction.
- `src/app/api/datasets/[id]/rows/route.ts`: add page-bounded search/filter and keep existing list/detail projection.
- `src/app/api/datasets/[id]/rows/[rowId]/route.ts`: return metrics and adjudications for full admin detail.
- `src/app/api/datasets/[id]/rows/[rowId]/adjudication/route.ts`: admin/superadmin save/read final reviewer decision.
- `src/app/api/datasets/[id]/import-jobs/route.ts`: page-bounded import job list for a dataset.
- `src/app/api/import-jobs/[jobId]/route.ts`: import job detail.
- `src/app/api/import-jobs/[jobId]/retry/route.ts`: safe retry metadata endpoint if retry is implementable without row duplication; otherwise return `RETRY_NOT_SUPPORTED`.
- `src/app/api/import-jobs/[jobId]/cancel/route.ts`: safe cancel for queued/running jobs with no inserted rows; otherwise return `CANCEL_NOT_SAFE`.
- `src/app/api/datasets/[id]/imports/route.ts`: populate new job metadata and retain active-import blocking.
- `src/lib/datasets/row-export.ts`: include adjudication in row detail/export.
- `src/app/annotator/tasks/page.tsx`: task-group list UI.
- `src/app/annotator/tasks/[id]/page.tsx`: task-group workspace that loads random next item and handles submit/skip.
- `src/app/admin/datasets/[id]/page.tsx`: server-side row pagination/search/filter UI and full-row navigation.
- `src/app/admin/datasets/[id]/rows/[rowId]/page.tsx`: full admin log detail page.
- `src/components/admin/dataset-row-table.tsx`: compact row table with route open behavior and pagination props.
- `src/components/admin/dataset-import-jobs-panel.tsx`: import job visibility panel.
- `src/components/admin/adjudication-panel.tsx`: reviewer final-decision editor.
- `src/components/annotation/annotation-workspace.tsx`: shared metric/detail-field UI for annotator workspace and admin read/review page.
- `tests/e2e/full-flow.spec.ts`: update full flow from row-task list to task-group workflow and full admin detail.
- `tests/e2e/navigation-performance.spec.ts`: update heading/copy assertions if annotator task page copy changes.
- `tests/e2e/annotation-queue.spec.ts`: focused annotator/admin/superadmin queue, skip, adjudication coverage.

## Task 1: Data Model And Pure Helpers

**Files:**
- Create: `migrations/0022_annotation_queue_adjudication.sql`
- Modify: `src/db/datasets.ts`
- Modify: `src/db/datasets.sqlite.ts`
- Modify: `scripts/seed-local.ts`
- Modify: `scripts/seed-navigation-performance.ts`
- Create: `src/lib/datasets/task-groups.ts`
- Create: `src/lib/datasets/adjudication.ts`
- Create: `tests/datasets/task-groups.test.ts`
- Create: `tests/datasets/adjudication.test.ts`
- Create: `tests/datasets/import-jobs.test.ts`
- Modify: `tests/datasets/run.ts`

- [ ] **Step 1: Write task-group helper tests**

Create `tests/datasets/task-groups.test.ts`:

```ts
import assert from "node:assert/strict";
import {
  buildTaskGroups,
  chooseNextAssignment,
  markSkippedForQueue,
  type QueueAssignment,
} from "../../src/lib/datasets/task-groups";

const assignments: QueueAssignment[] = [
  { id: "a1", assignmentRunId: "run-1", datasetId: "d1", datasetName: "Dataset A", annotatorId: "u1", metricKey: "m1,m2", metricLabels: ["M1", "M2"], status: "assigned", skippedAt: null, assignedAt: "2026-07-29T01:00:00.000Z" },
  { id: "a2", assignmentRunId: "run-1", datasetId: "d1", datasetName: "Dataset A", annotatorId: "u1", metricKey: "m1,m2", metricLabels: ["M1", "M2"], status: "completed", skippedAt: null, assignedAt: "2026-07-29T01:01:00.000Z" },
  { id: "a3", assignmentRunId: "run-1", datasetId: "d1", datasetName: "Dataset A", annotatorId: "u1", metricKey: "m1,m2", metricLabels: ["M1", "M2"], status: "in_progress", skippedAt: "2026-07-29T01:02:00.000Z", assignedAt: "2026-07-29T01:02:00.000Z" },
  { id: "a4", assignmentRunId: "run-2", datasetId: "d1", datasetName: "Dataset A", annotatorId: "u1", metricKey: "m1", metricLabels: ["M1"], status: "assigned", skippedAt: null, assignedAt: "2026-07-29T01:03:00.000Z" },
];

const groups = buildTaskGroups(assignments);
assert.equal(groups.length, 2);
assert.deepEqual(groups[0], {
  id: "run-1",
  assignmentRunId: "run-1",
  datasetId: "d1",
  datasetName: "Dataset A",
  metricKey: "m1,m2",
  metricLabels: ["M1", "M2"],
  totalCount: 3,
  submittedCount: 1,
  remainingCount: 2,
  skippedCount: 1,
  status: "in_progress",
  assignedAt: "2026-07-29T01:00:00.000Z",
});

assert.equal(chooseNextAssignment(assignments.filter((item) => item.assignmentRunId === "run-1"), () => 0)?.id, "a1");
assert.equal(chooseNextAssignment(assignments.filter((item) => item.id !== "a1" && item.assignmentRunId === "run-1"), () => 0)?.id, "a3");
assert.equal(markSkippedForQueue({ skippedAt: null, skipCount: 0 }, "2026-07-29T02:00:00.000Z").skipCount, 1);
```

- [ ] **Step 2: Write adjudication/export helper tests**

Create `tests/datasets/adjudication.test.ts`:

```ts
import assert from "node:assert/strict";
import { attachAdjudicationToExport, type ReviewerAdjudication } from "../../src/lib/datasets/adjudication";

const adjudications: ReviewerAdjudication[] = [
  { rowId: "row-1", metricId: "metric-1", metricKey: "policy_violation", reviewerId: "admin-1", reviewerName: "Admin", value: "Pass", note: "final", updatedAt: "2026-07-29T03:00:00.000Z" },
];

const exportRow = {
  row_id: 1,
  source_id: null,
  data: { input: "abc" },
  annotation: {
    completed_count: 1,
    target_overlap: 3,
    agreement: null,
    annotated_by: [{ id: "ann-1", name: "Annotator" }],
    results: [{ assignment_id: "as-1", annotator: { id: "ann-1", name: "Annotator" }, status: "completed", metrics: { policy_violation: { label: "Vi phạm", value: "Failed", note: "vote" } } }],
  },
};

const attached = attachAdjudicationToExport(exportRow, adjudications);
assert.equal(attached.annotation.results[0].metrics.policy_violation.value, "Failed");
assert.deepEqual(attached.adjudication.policy_violation, {
  metric_id: "metric-1",
  reviewer: { id: "admin-1", name: "Admin" },
  value: "Pass",
  note: "final",
  updated_at: "2026-07-29T03:00:00.000Z",
});
```

- [ ] **Step 3: Write import-job helper tests**

Create `tests/datasets/import-jobs.test.ts`:

```ts
import assert from "node:assert/strict";
import { projectImportJobStatus } from "../../src/lib/datasets/task-groups";

assert.deepEqual(projectImportJobStatus({ status: "in_progress", rowCount: 500, targetRowCount: 1000, errorMessage: null }), {
  status: "running",
  rowCount: 500,
  targetRowCount: 1000,
  progress: 50,
  canCancel: false,
  canRetry: false,
});

assert.deepEqual(projectImportJobStatus({ status: "failed", rowCount: 250, targetRowCount: 1000, errorMessage: "bad row" }).canRetry, true);
```

- [ ] **Step 4: Add tests to runner and verify RED**

Modify `tests/datasets/run.ts` so it imports the new tests:

```ts
import "./task-groups.test";
import "./adjudication.test";
import "./import-jobs.test";
```

Run: `pnpm run test:datasets`

Expected: FAIL because `src/lib/datasets/task-groups.ts` and `src/lib/datasets/adjudication.ts` do not exist.

- [ ] **Step 5: Add Postgres migration**

Create `migrations/0022_annotation_queue_adjudication.sql`:

```sql
ALTER TABLE annotation_assignments
  ADD COLUMN IF NOT EXISTS skipped_at TIMESTAMPTZ;

ALTER TABLE annotation_assignments
  ADD COLUMN IF NOT EXISTS skip_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS annotation_assignments_group_queue_idx
  ON annotation_assignments(annotator_id, assignment_run_id, status, skipped_at, assigned_at);

ALTER TABLE dataset_imports
  ADD COLUMN IF NOT EXISTS target_row_count INTEGER;

ALTER TABLE dataset_imports
  ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE dataset_imports
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

ALTER TABLE dataset_imports
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS dataset_imports_dataset_status_idx
  ON dataset_imports(dataset_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS annotation_adjudications (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  row_id TEXT NOT NULL REFERENCES dataset_rows(id) ON DELETE CASCADE,
  metric_id TEXT NOT NULL REFERENCES annotation_metrics(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  reviewer_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  value TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT annotation_adjudications_row_metric_unique UNIQUE(row_id, metric_id)
);

CREATE INDEX IF NOT EXISTS annotation_adjudications_dataset_row_idx
  ON annotation_adjudications(dataset_id, row_id);
```

- [ ] **Step 6: Add schema parity**

Update `src/db/datasets.ts` and `src/db/datasets.sqlite.ts`:

```ts
export const annotationAdjudications = pgTable(
  "annotation_adjudications",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    datasetId: text("dataset_id").notNull().references(() => datasets.id, { onDelete: "cascade" }),
    rowId: text("row_id").notNull().references(() => datasetRows.id, { onDelete: "cascade" }),
    metricId: text("metric_id").notNull().references(() => annotationMetrics.id, { onDelete: "cascade" }),
    metricKey: text("metric_key").notNull(),
    reviewerId: text("reviewer_id").references(() => profiles.id, { onDelete: "set null" }),
    value: text("value"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("annotation_adjudications_row_metric_unique").on(t.rowId, t.metricId),
    index("annotation_adjudications_dataset_row_idx").on(t.datasetId, t.rowId),
  ],
);
```

Use SQLite equivalents in `src/db/datasets.sqlite.ts` with `sqliteTable`, `uniqueIndex`, `text("created_at")`, `text("updated_at")`, and `text("submitted_at")`.

Add to `annotationAssignments`:

```ts
skippedAt: timestamp("skipped_at", { withTimezone: true }),
skipCount: integer("skip_count").notNull().default(0),
```

Use SQLite `text("skipped_at")` and `integer("skip_count").notNull().default(0)`.

Add to `datasetImports`:

```ts
targetRowCount: integer("target_row_count"),
errorMessage: text("error_message"),
startedAt: timestamp("started_at", { withTimezone: true }),
completedAt: timestamp("completed_at", { withTimezone: true }),
```

Use SQLite text timestamps for `startedAt` and `completedAt`.

- [ ] **Step 7: Update local seed SQL parity**

Modify `scripts/seed-local.ts` and `scripts/seed-navigation-performance.ts` table creation SQL to include the same new columns and this table:

```sql
CREATE TABLE IF NOT EXISTS annotation_adjudications (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  row_id TEXT NOT NULL REFERENCES dataset_rows(id) ON DELETE CASCADE,
  metric_id TEXT NOT NULL REFERENCES annotation_metrics(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  reviewer_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  value TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  submitted_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS annotation_adjudications_row_metric_unique ON annotation_adjudications(row_id, metric_id);
CREATE INDEX IF NOT EXISTS annotation_adjudications_dataset_row_idx ON annotation_adjudications(dataset_id, row_id);
```

- [ ] **Step 8: Implement pure helpers**

Create `src/lib/datasets/task-groups.ts`:

```ts
export type AssignmentQueueStatus = "assigned" | "in_progress" | "completed" | string;

export interface QueueAssignment {
  id: string;
  assignmentRunId: string;
  datasetId: string;
  datasetName: string;
  annotatorId: string;
  metricKey: string;
  metricLabels: string[];
  status: AssignmentQueueStatus;
  skippedAt: string | null;
  assignedAt: string;
}

export interface TaskGroupSummary {
  id: string;
  assignmentRunId: string;
  datasetId: string;
  datasetName: string;
  metricKey: string;
  metricLabels: string[];
  totalCount: number;
  submittedCount: number;
  remainingCount: number;
  skippedCount: number;
  status: "not_started" | "in_progress" | "completed";
  assignedAt: string;
}

export function buildTaskGroups(assignments: QueueAssignment[]): TaskGroupSummary[] {
  const groups = new Map<string, QueueAssignment[]>();
  for (const assignment of assignments) {
    groups.set(assignment.assignmentRunId, [...(groups.get(assignment.assignmentRunId) ?? []), assignment]);
  }

  return [...groups.entries()]
    .map(([assignmentRunId, groupAssignments]) => {
      const first = groupAssignments[0];
      const submittedCount = groupAssignments.filter((item) => item.status === "completed").length;
      const remainingCount = groupAssignments.length - submittedCount;
      const skippedCount = groupAssignments.filter((item) => item.status !== "completed" && item.skippedAt).length;
      const startedCount = groupAssignments.filter((item) => item.status === "in_progress" || item.status === "completed").length;
      return {
        id: assignmentRunId,
        assignmentRunId,
        datasetId: first.datasetId,
        datasetName: first.datasetName,
        metricKey: first.metricKey,
        metricLabels: first.metricLabels,
        totalCount: groupAssignments.length,
        submittedCount,
        remainingCount,
        skippedCount,
        status: remainingCount === 0 ? "completed" : startedCount > 0 ? "in_progress" : "not_started",
        assignedAt: groupAssignments.map((item) => item.assignedAt).sort()[0],
      };
    })
    .sort((a, b) => b.assignedAt.localeCompare(a.assignedAt));
}

export function chooseNextAssignment(assignments: QueueAssignment[], random: () => number = Math.random): QueueAssignment | null {
  const eligible = assignments.filter((item) => item.status !== "completed");
  const unskipped = eligible.filter((item) => !item.skippedAt);
  const pool = unskipped.length > 0 ? unskipped : eligible;
  if (pool.length === 0) return null;
  return pool[Math.floor(random() * pool.length)];
}

export function markSkippedForQueue(input: { skippedAt: string | null; skipCount: number }, nowIso: string) {
  return { skippedAt: nowIso, skipCount: input.skipCount + 1 };
}

export function projectImportJobStatus(input: { status: string; rowCount: number; targetRowCount: number | null; errorMessage: string | null }) {
  const normalized = input.status === "in_progress" ? "running" : input.status === "completed" ? "completed" : input.status;
  const target = input.targetRowCount ?? input.rowCount;
  return {
    status: normalized,
    rowCount: input.rowCount,
    targetRowCount: input.targetRowCount,
    progress: target > 0 ? Math.min(100, Math.round((input.rowCount / target) * 100)) : 0,
    canCancel: false,
    canRetry: input.status === "failed",
    errorMessage: input.errorMessage,
  };
}
```

Create `src/lib/datasets/adjudication.ts`:

```ts
export interface ReviewerAdjudication {
  rowId: string;
  metricId: string;
  metricKey: string;
  reviewerId: string | null;
  reviewerName: string | null;
  value: string | null;
  note: string | null;
  updatedAt: string;
}

export function buildAdjudicationMap(adjudications: ReviewerAdjudication[]) {
  return Object.fromEntries(
    adjudications.map((item) => [
      item.metricKey,
      {
        metric_id: item.metricId,
        reviewer: { id: item.reviewerId, name: item.reviewerName },
        value: item.value,
        note: item.note,
        updated_at: item.updatedAt,
      },
    ]),
  );
}

export function attachAdjudicationToExport<T extends object>(row: T, adjudications: ReviewerAdjudication[]) {
  return { ...row, adjudication: buildAdjudicationMap(adjudications) };
}
```

- [ ] **Step 9: Verify helper tests GREEN**

Run: `pnpm run test:datasets`

Expected: PASS.

- [ ] **Step 10: Commit data/helper lane**

```bash
git add migrations/0022_annotation_queue_adjudication.sql src/db/datasets.ts src/db/datasets.sqlite.ts scripts/seed-local.ts scripts/seed-navigation-performance.ts src/lib/datasets/task-groups.ts src/lib/datasets/adjudication.ts tests/datasets/task-groups.test.ts tests/datasets/adjudication.test.ts tests/datasets/import-jobs.test.ts tests/datasets/run.ts
git commit -m "feat: add annotation queue data helpers"
```

## Task 2: Backend APIs For Queues, Skip, Adjudication, And Import Jobs

**Files:**
- Create: `src/app/api/annotator/task-groups/route.ts`
- Create: `src/app/api/annotator/task-groups/[groupId]/next/route.ts`
- Create: `src/app/api/annotator/tasks/[id]/skip/route.ts`
- Modify: `src/app/api/annotator/tasks/[id]/route.ts`
- Modify: `src/app/api/annotator/tasks/[id]/submit/route.ts`
- Modify: `src/app/api/datasets/[id]/rows/[rowId]/route.ts`
- Create: `src/app/api/datasets/[id]/rows/[rowId]/adjudication/route.ts`
- Create: `src/app/api/datasets/[id]/import-jobs/route.ts`
- Create: `src/app/api/import-jobs/[jobId]/route.ts`
- Create: `src/app/api/import-jobs/[jobId]/retry/route.ts`
- Create: `src/app/api/import-jobs/[jobId]/cancel/route.ts`
- Modify: `src/app/api/datasets/[id]/imports/route.ts`
- Modify: `src/lib/datasets/row-export.ts`

- [ ] **Step 1: Add task-group API**

Create `src/app/api/annotator/task-groups/route.ts`. Query current user's assignments joined to datasets and metrics, then use `buildTaskGroups`.

Response shape:

```ts
{
  taskGroups: Array<{
    id: string;
    assignmentRunId: string;
    datasetId: string;
    datasetName: string;
    metricLabels: string[];
    totalCount: number;
    submittedCount: number;
    remainingCount: number;
    skippedCount: number;
    status: "not_started" | "in_progress" | "completed";
    assignedAt: string;
  }>;
}
```

Run: `pnpm run typecheck`

Expected: PASS.

- [ ] **Step 2: Add random next API**

Create `src/app/api/annotator/task-groups/[groupId]/next/route.ts`.

Behavior:

- require annotator;
- `groupId` is `annotation_assignments.assignment_run_id`;
- load only assignments owned by current user for that run;
- return 404 when group not owned by current user;
- return `{ done: true, nextTaskId: null }` when all completed;
- otherwise return `{ done: false, nextTaskId: assignment.id }` from `chooseNextAssignment`.

Run: `pnpm run typecheck`

Expected: PASS.

- [ ] **Step 3: Add skip API**

Create `src/app/api/annotator/tasks/[id]/skip/route.ts`:

```ts
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { annotationAssignments } from "@/db/datasets";
import { requireAnnotator } from "@/lib/auth-middleware";
import { markSkippedForQueue } from "@/lib/datasets/task-groups";

export const POST = requireAnnotator(async (_req, session, context) => {
  const assignmentId = context?.params.id;
  if (!assignmentId) return NextResponse.json({ error: "MISSING_TASK_ID" }, { status: 400 });
  const assignment = (await db.select().from(annotationAssignments).where(eq(annotationAssignments.id, assignmentId)))[0];
  if (!assignment || assignment.annotatorId !== session.user.id) return NextResponse.json({ error: "TASK_NOT_FOUND" }, { status: 404 });
  if (assignment.status === "completed") return NextResponse.json({ error: "TASK_ALREADY_COMPLETED" }, { status: 409 });

  const now = new Date();
  const update = markSkippedForQueue(
    { skippedAt: assignment.skippedAt ? String(assignment.skippedAt) : null, skipCount: Number(assignment.skipCount ?? 0) },
    now.toISOString(),
  );
  await db
    .update(annotationAssignments)
    .set({ skippedAt: now, skipCount: update.skipCount, updatedAt: now })
    .where(and(eq(annotationAssignments.id, assignmentId), eq(annotationAssignments.annotatorId, session.user.id)));

  return NextResponse.json({ ok: true, status: "skipped", assignmentRunId: assignment.assignmentRunId });
});
```

Adjust timestamp values for SQLite compatibility if Drizzle local schema returns strings.

- [ ] **Step 4: Preserve skip metadata on draft and clear it on submit**

Modify `src/app/api/annotator/tasks/[id]/draft/route.ts` so autosave leaves `skippedAt` unchanged.

Modify `src/app/api/annotator/tasks/[id]/submit/route.ts` so the transaction sets:

```ts
status: "completed",
completedAt: now,
skippedAt: null,
updatedAt: now,
```

Return:

```ts
return NextResponse.json({ ok: true, status: "completed", assignmentRunId: assignment.assignmentRunId });
```

- [ ] **Step 5: Enrich assignment detail API**

Modify `src/app/api/annotator/tasks/[id]/route.ts` to include:

```ts
assignmentRunId: assignment.assignmentRunId,
skippedAt: assignment.skippedAt,
```

Keep ownership enforcement exactly as current code does.

- [ ] **Step 6: Add adjudication read/write API**

Create `src/app/api/datasets/[id]/rows/[rowId]/adjudication/route.ts`.

GET:

- require admin;
- load adjudications for row joined to profiles and metrics;
- return `{ adjudications: ReviewerAdjudication[] }`.

POST body:

```ts
const schema = z.object({
  values: z.record(z.string().nullable()),
  notes: z.record(z.string()).optional(),
});
```

POST behavior:

- require admin/superadmin via existing `requireAdmin`;
- validate row belongs to dataset;
- validate metric ids belong to dataset;
- upsert one `annotation_adjudications` row per metric id;
- do not update `annotation_results`.

Run: `pnpm run typecheck`

Expected: PASS.

- [ ] **Step 7: Enrich admin row detail and export with adjudication**

Modify `src/app/api/datasets/[id]/rows/[rowId]/route.ts`:

- include metric `description`, `scaleJson`, `required`, and `sortOrder`;
- include all assignment statuses, including skipped metadata;
- include adjudications in response as `row.adjudication`.

Modify `src/lib/datasets/row-export.ts`:

- accept optional adjudications;
- return `adjudication` from `buildAnnotatedRow`;
- keep `annotation.results` unchanged.

- [ ] **Step 8: Add import job APIs**

Create `src/app/api/datasets/[id]/import-jobs/route.ts`:

- require admin;
- accept `page` and `pageSize` with page size cap 50;
- list `dataset_imports` for dataset ordered by `created_at desc`;
- use `projectImportJobStatus`.

Create `src/app/api/import-jobs/[jobId]/route.ts`:

- require admin;
- return one import job plus dataset name.

Create retry/cancel endpoints:

- `retry`: return `409 RETRY_NOT_SUPPORTED` unless status is `failed`; if status is failed, return a new job descriptor without inserting rows only if retry can be idempotently implemented from stored file content. Because current DB does not store original content, first implementation should return `RETRY_NOT_SUPPORTED` with a clear message.
- `cancel`: allow only status `in_progress` with `rowCount = 0`; otherwise return `CANCEL_NOT_SAFE`.

- [ ] **Step 9: Update import route metadata**

Modify `src/app/api/datasets/[id]/imports/route.ts`:

- set `targetRowCount` to `totalRows ?? rows.length`;
- set `startedAt` on first request;
- set `completedAt` when complete;
- set `errorMessage` only in caught/failed paths where the job exists;
- keep existing domain active-import blocking.

- [ ] **Step 10: Verify backend checks**

Run:

```bash
pnpm run typecheck
pnpm run test:datasets
```

Expected: both PASS.

- [ ] **Step 11: Commit backend API lane**

```bash
git add src/app/api/annotator/task-groups src/app/api/annotator/tasks src/app/api/datasets src/app/api/import-jobs src/lib/datasets/row-export.ts
git commit -m "feat: add annotation queue APIs"
```

## Task 3: Annotator Task Group UI And Random Workspace

**Files:**
- Create: `src/components/annotation/annotation-workspace.tsx`
- Modify: `src/app/annotator/tasks/page.tsx`
- Modify: `src/app/annotator/tasks/[id]/page.tsx`
- Modify: `tests/e2e/navigation-performance.spec.ts`

- [ ] **Step 1: Create shared annotation workspace component**

Create `src/components/annotation/annotation-workspace.tsx` with props:

```ts
export interface AnnotationWorkspaceMetric {
  id: string;
  key: string;
  label: string;
  description: string | null;
  scale: { values: string[] };
  required: boolean;
}

export interface AnnotationWorkspaceProps {
  datasetName: string;
  internalRowId: number;
  status: string;
  detailFields: Record<string, unknown>;
  metrics: AnnotationWorkspaceMetric[];
  values: Record<string, string>;
  notes: Record<string, string>;
  disabled?: boolean;
  onValueChange: (metricId: string, value: string) => void;
  onNoteChange: (metricId: string, note: string) => void;
}
```

The component renders the same detail field and metric controls currently in `src/app/annotator/tasks/[id]/page.tsx`. Move UI markup, not autosave/submit state, into this component.

- [ ] **Step 2: Replace annotator task list with task groups**

Modify `src/app/annotator/tasks/page.tsx`:

- fetch `/api/annotator/task-groups`;
- heading stays concise: `Task được giao`;
- show dataset, assigned date, metric labels, remaining/total, submitted, skipped, status;
- action link goes to `/annotator/tasks/${group.id}`;
- do not render raw row fields in the task group list.

Empty state: `Chưa có task được giao.`

- [ ] **Step 3: Convert detail route to task-group workspace**

Modify `src/app/annotator/tasks/[id]/page.tsx` so param `id` is a task group id:

- on load, call `/api/annotator/task-groups/${groupId}/next`;
- if `done`, render completed task-group state and link back to `/annotator/tasks`;
- otherwise fetch `/api/annotator/tasks/${nextTaskId}`;
- keep autosave against the current assignment id;
- after submit, call submit endpoint, then call next endpoint again;
- after skip, call skip endpoint, then call next endpoint again;
- preserve dirty warning.

Use `router.replace(`/annotator/tasks/${groupId}?item=${nextTaskId}`)` only for URL traceability; the backend remains source of truth for random next.

- [ ] **Step 4: Add Skip action**

Add a secondary button next to Submit:

```tsx
<Button type="button" variant="outline" onClick={skipCurrentTask} disabled={submitting || saving || task?.status === "completed"}>
  Skip
</Button>
```

`skipCurrentTask` must refuse when `dirty` is true and an autosave is currently in flight. It should not clear local state until the next item is loaded successfully.

- [ ] **Step 5: Update navigation performance assertions**

Modify `tests/e2e/navigation-performance.spec.ts` heading assertions from `Task của tôi` to `Task được giao`.

- [ ] **Step 6: Verify annotator UI**

Run:

```bash
pnpm run typecheck
pnpm exec playwright test tests/e2e/navigation-performance.spec.ts --project=chromium-desktop --grep "annotator"
```

Expected: both PASS.

- [ ] **Step 7: Commit annotator UI lane**

```bash
git add src/components/annotation/annotation-workspace.tsx src/app/annotator/tasks tests/e2e/navigation-performance.spec.ts
git commit -m "feat: add annotator task queues"
```

## Task 4: Admin Detail, Import Jobs, Row Pagination, And Export UI

**Files:**
- Modify: `src/app/api/datasets/[id]/rows/route.ts`
- Modify: `src/app/admin/datasets/[id]/page.tsx`
- Create: `src/app/admin/datasets/[id]/rows/[rowId]/page.tsx`
- Modify: `src/components/admin/dataset-row-table.tsx`
- Create: `src/components/admin/dataset-import-jobs-panel.tsx`
- Create: `src/components/admin/adjudication-panel.tsx`
- Modify: `src/components/admin/dataset-row-detail-dialog.tsx` or stop rendering it from the page.
- Modify: `src/app/api/datasets/[id]/export/route.ts`

- [ ] **Step 1: Add row-list query params**

Modify `src/app/api/datasets/[id]/rows/route.ts` to accept:

```ts
const page = Math.max(Number(searchParams.get("page") ?? 1), 1);
const pageSize = Math.min(Math.max(Number(searchParams.get("pageSize") ?? 50), 1), 100);
const q = searchParams.get("q")?.trim() ?? "";
const completion = searchParams.get("completion") ?? "";
```

Filtering rules:

- `q` filters `internalRowId` exact string match or lower-cased `rawJson::text` / local equivalent where safe;
- `completion=completed` rows with completed count >= target overlap;
- `completion=incomplete` rows with completed count < target overlap;
- if completion filtering is too expensive in one SQL query, apply it only to current page in the first pass and label the filter as page-scoped in code comments.

- [ ] **Step 2: Route row open to full page**

Modify `src/components/admin/dataset-row-table.tsx`:

- keep checkbox click propagation stop;
- expose `onRowOpen`;
- use row hover and keyboard-friendly open affordance;
- keep compact list columns.

Modify `src/app/admin/datasets/[id]/page.tsx`:

- track `rowPage`, `rowPageSize`, `rowSearch`, and completion filter;
- fetch `/api/datasets/${datasetId}/rows?page=${rowPage}&pageSize=${rowPageSize}&fields=list&q=${rowSearch}`;
- row click navigates to `/admin/datasets/${datasetId}/rows/${row.id}?from=${encodeURIComponent(currentSearch)}`;
- remove `pageSize=200`.

- [ ] **Step 3: Add full admin row detail page**

Create `src/app/admin/datasets/[id]/rows/[rowId]/page.tsx`.

The page fetches:

- `/api/datasets/${datasetId}/rows/${rowId}`;
- `/api/datasets/${datasetId}/rows/${rowId}/adjudication`.

Render:

- row detail fields;
- metrics/annotation target using `AnnotationWorkspace` in disabled mode;
- annotator results cards;
- `AdjudicationPanel`;
- back link to dataset.

- [ ] **Step 4: Add adjudication panel**

Create `src/components/admin/adjudication-panel.tsx`:

```ts
interface AdjudicationPanelProps {
  datasetId: string;
  rowId: string;
  metrics: Array<{ id: string; key: string; label: string; description: string | null; scale: { values: string[] } }>;
  initialValues: Record<string, { value: string | null; note: string | null }>;
  onSaved?: () => void;
}
```

POST to `/api/datasets/${datasetId}/rows/${rowId}/adjudication`. Show `Đã lưu adjudication` only after the POST succeeds.

- [ ] **Step 5: Add import jobs panel**

Create `src/components/admin/dataset-import-jobs-panel.tsx`:

- fetch `/api/datasets/${datasetId}/import-jobs?pageSize=5`;
- show latest job status/progress/error;
- show `queued/running/completed/failed/canceled` labels;
- disable retry/cancel buttons unless the API says the action is allowed.

Replace or extend the right-side append panel area in `src/app/admin/datasets/[id]/page.tsx`.

- [ ] **Step 6: Update export route with adjudication**

Modify `src/app/api/datasets/[id]/export/route.ts`:

- load adjudications joined to metrics/profiles for exported rows;
- call `attachAdjudicationToExport`;
- keep content type `application/x-ndjson`;
- include unannotated rows.

- [ ] **Step 7: Verify admin UI**

Run:

```bash
pnpm run typecheck
pnpm run test:datasets
```

Expected: both PASS.

- [ ] **Step 8: Commit admin lane**

```bash
git add src/app/api/datasets src/app/api/import-jobs src/app/admin/datasets src/components/admin/dataset-row-table.tsx src/components/admin/dataset-import-jobs-panel.tsx src/components/admin/adjudication-panel.tsx src/components/admin/dataset-row-detail-dialog.tsx
git commit -m "feat: add admin row adjudication workflow"
```

## Task 5: Integration, E2E, Performance, And Regression Gates

**Files:**
- Modify: `tests/e2e/full-flow.spec.ts`
- Create: `tests/e2e/annotation-queue.spec.ts`
- Modify: `tests/e2e/navigation-performance.spec.ts`
- Optional modify: `scripts/benchmark-navigation-performance.ts`

- [ ] **Step 1: Update full flow for task groups**

Modify `tests/e2e/full-flow.spec.ts`:

- after assign, annotator visits `/annotator/tasks`;
- expect heading `Task được giao`;
- open task group for dataset;
- assert full annotation workspace appears;
- fill all metric pass values and notes;
- wait for autosave;
- reload and assert draft persists;
- submit and assert either another random item appears or group completed state appears.

- [ ] **Step 2: Add focused queue/adjudication Playwright**

Create `tests/e2e/annotation-queue.spec.ts` covering:

```ts
test("annotator skips temporarily and later receives skipped item after other items", async ({ page }) => {
  // seed through existing API helpers in full-flow style
  // login annotator
  // open task group
  // capture first row id
  // click Skip
  // assert next row id differs when another eligible row exists
  // complete remaining unskipped rows
  // assert skipped row becomes eligible again
});

test("admin saves adjudication without changing annotator vote", async ({ page }) => {
  // login admin
  // open dataset row full page
  // save reviewer value opposite to annotator value
  // fetch export
  // assert annotation.results still contains annotator value
  // assert adjudication contains reviewer value
});

test("superadmin can open row detail and save adjudication", async ({ page }) => {
  // login superadmin
  // open same full row page
  // update adjudication note
  // expect saved confirmation
});
```

Use real UI selectors and existing local users from the current e2e helpers. Do not bypass auth by directly setting cookies unless existing tests already do so.

- [ ] **Step 3: Add import job assertions**

In `tests/e2e/full-flow.spec.ts` or `annotation-queue.spec.ts`:

- create/import a partial dataset;
- assert dataset detail shows active import job;
- assert duplicate import attempt returns `DATASET_IMPORT_IN_PROGRESS`;
- complete import and assert job is completed and dataset assign is enabled.

- [ ] **Step 4: Run full verification**

Run:

```bash
pnpm run typecheck
pnpm run test:datasets
pnpm exec playwright test tests/e2e/annotation-queue.spec.ts --project=chromium-desktop --workers=1
pnpm exec playwright test tests/e2e/full-flow.spec.ts --project=chromium-desktop --workers=1
pnpm exec playwright test tests/e2e/navigation-performance.spec.ts --project=chromium-desktop --workers=1
pnpm run build
git diff --check
```

Expected: all PASS.

- [ ] **Step 5: Commit integration tests**

```bash
git add tests/e2e/full-flow.spec.ts tests/e2e/annotation-queue.spec.ts tests/e2e/navigation-performance.spec.ts scripts/benchmark-navigation-performance.ts
git commit -m "test: cover annotation queue workflow"
```

## Herdr Delivery Contract

```yaml
herdr_delivery:
  backend: herdr
  approval_state: pending_user_approval
  root: /Users/haido/expert-review
  approved_spec:
    path: docs/superpowers/specs/2026-07-29-annotator-queue-admin-adjudication-import-jobs-design.md
    sha256: 48c02706c9a2ea87fc88eed711e6270e44342ccd04eeee98be114f160586ba94
  base_sha: 30bd9f38b95576f98d7cc3f77a304b8335dc6ac8
  dirty_tree_policy:
    status_at_plan_time: dirty
    requirement_before_dispatch: clean tree or clean isolated worktree
    prohibited_actions: [revert_user_or_prior_changes, git_reset_hard]
  gate: standard
  gate_reason: schema, API, RBAC, browser UI, persistence, and performance scope
  lanes:
    - lane_id: data-model-helpers
      role: implementation
      eligible_slots: [P2, P3, P4]
      dependency_wave: 1
      owned_paths:
        - migrations/0022_annotation_queue_adjudication.sql
        - src/db/datasets.ts
        - src/db/datasets.sqlite.ts
        - scripts/seed-local.ts
        - scripts/seed-navigation-performance.ts
        - src/lib/datasets/task-groups.ts
        - src/lib/datasets/adjudication.ts
        - tests/datasets/task-groups.test.ts
        - tests/datasets/adjudication.test.ts
        - tests/datasets/import-jobs.test.ts
        - tests/datasets/run.ts
      prerequisites: []
      acceptance:
        - pnpm run test:datasets passes for task group, adjudication, and import job helper behavior
        - pnpm run typecheck passes after schema additions
      terminal_checks:
        - pnpm run test:datasets
        - pnpm run typecheck
    - lane_id: backend-apis
      role: implementation
      eligible_slots: [P2, P3, P4]
      dependency_wave: 2
      owned_paths:
        - src/app/api/annotator/task-groups/**
        - src/app/api/annotator/tasks/**
        - src/app/api/datasets/**
        - src/app/api/import-jobs/**
        - src/lib/datasets/row-export.ts
      prerequisites:
        - data-model-helpers accepted
      acceptance:
        - annotator task group, next, skip, submit, row detail, adjudication, import job, and export APIs typecheck
        - dataset helper tests still pass
      terminal_checks:
        - pnpm run test:datasets
        - pnpm run typecheck
    - lane_id: frontend-workflows
      role: implementation
      eligible_slots: [P2, P3, P4]
      dependency_wave: 3
      owned_paths:
        - src/components/annotation/annotation-workspace.tsx
        - src/app/annotator/tasks/**
        - src/app/admin/datasets/**
        - src/components/admin/dataset-row-table.tsx
        - src/components/admin/dataset-import-jobs-panel.tsx
        - src/components/admin/adjudication-panel.tsx
        - src/components/admin/dataset-row-detail-dialog.tsx
        - tests/e2e/navigation-performance.spec.ts
      prerequisites:
        - backend-apis accepted
      acceptance:
        - annotator task list is grouped by assignment run
        - annotator workspace supports random next, submit, skip, autosave
        - admin dataset rows navigate to full detail page
        - admin adjudication and import jobs UI render without full shell loading
      terminal_checks:
        - pnpm run typecheck
        - pnpm exec playwright test tests/e2e/navigation-performance.spec.ts --project=chromium-desktop --workers=1
  reviews:
    P5:
      applicable: true
      role: integration-owner
      owned_paths:
        - tests/e2e/full-flow.spec.ts
        - tests/e2e/annotation-queue.spec.ts
        - tests/e2e/navigation-performance.spec.ts
        - scripts/benchmark-navigation-performance.ts
      responsibilities:
        - prepare RED integration tests while implementation lanes run
        - integrate accepted lane outputs
        - run full local verification
    P6:
      applicable: true
      role: integration-reviewer
      reason: schema/API/UI integration and data persistence risk
    P7:
      applicable: true
      role: qc
      reason: full annotator/admin/superadmin functional matrix required
    P8:
      applicable: true
      role: designer
      reason: UI/UX and loading behavior are explicit acceptance criteria
    P9:
      applicable: true
      role: persona
      reason: three personas must be exercised: annotator, admin, superadmin
  blocking_severity:
    data_loss_or_annotation_overwrite: blocker
    auth_or_role_leak: blocker
    mutation_without_transaction_for_submit_or_adjudication: blocker
    unbounded_task_or_row_list_query: high
    shell_full_page_loading_regression: high
    visual_polish_issue_without_functional_risk: medium
  review_matrices:
    data_safety:
      - draft survives reload
      - skip preserves draft
      - submit stores every required metric before completion
      - adjudication never updates annotation_results
      - export includes votes plus reviewer final decision
    rbac:
      - annotator only sees own assignments
      - admin can view/adjudicate all dataset rows
      - superadmin can view/adjudicate all dataset rows
    performance:
      - dataset list bounded by page size
      - dataset rows bounded by page size
      - task groups do not load all row payloads
      - random next fetches one item
    design:
      - no full-shell loading between sidebar tabs
      - list screens are compact and scannable
      - detail fields do not crowd list tables
  deployment:
    topology: local-first-no-deploy-during-plan
    dev_branch: dev
    prod_branch: main
    promotion_rule: push/deploy only after user explicitly requests after verification
    verification: local runtime with Playwright and build
  required_evidence:
    - git status before and after integration
    - pnpm run typecheck output
    - pnpm run test:datasets output
    - Playwright annotation queue output
    - Playwright full flow output
    - Playwright navigation performance output
    - pnpm run build output
    - git diff --check output
```

## Plan Self-Review

- Spec coverage: task grouping, random next, temporary skip, admin full detail, adjudication, import jobs, loading/performance, export, and data safety are covered by Tasks 1-5.
- Placeholder scan: no unresolved placeholder markers or unconstrained "handle later" steps remain. Retry is explicitly unsupported unless current stored data can make it idempotent.
- Type consistency: task groups use existing `assignmentRunId`; skip uses `skippedAt` and `skipCount`; adjudication is separate from `annotationResults`; import jobs extend `datasetImports`.
- Scope check: this is a large but coherent product slice with three Herdr implementation lanes plus P5 integration. It should use the Standard gate, not Compact.
