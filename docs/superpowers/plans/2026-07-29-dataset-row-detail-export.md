# Dataset Row Detail Export Implementation Plan

> **For Herdr delivery:** REQUIRED SUB-SKILL: Use
> `herdr-orchestrator` only after this plan is approved.

**Goal:** Add admin row detail inspection, tighter dataset list columns, and annotated JSONL export for Dataset workflows.

**Architecture:** Reuse the existing dataset tables and aggregation helpers. Add read-only admin APIs for a single row and export, keep annotator access limited to assigned tasks, and update the dataset detail UI to request list fields for the table while loading detail fields on demand.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Drizzle ORM, existing UI table/dialog components, Playwright, tsx dataset tests.

---

## File Map

- Create `src/lib/datasets/row-export.ts`: pure helpers to normalize JSON, project row fields, group row assignments/results, and shape annotated JSONL rows.
- Create `tests/datasets/row-export.test.ts`: unit coverage for unannotated rows, completed annotations, metric grouping, and agreement passthrough.
- Modify `tests/datasets/run.ts`: include the new row export test.
- Create `src/app/api/datasets/[id]/rows/[rowId]/route.ts`: admin-only single row detail endpoint.
- Create `src/app/api/datasets/[id]/export/route.ts`: admin-only annotated JSONL download endpoint.
- Modify `src/app/api/datasets/[id]/rows/route.ts`: continue paginated list endpoint, but keep it list/detail mode only and reuse shared helper where useful.
- Modify `src/app/admin/datasets/[id]/page.tsx`: request list rows with `fields=list`, pass `displayConfig.listFields`, wire row detail modal, add download button.
- Modify `src/components/admin/dataset-row-table.tsx`: make rows clickable without breaking checkbox selection; keep list columns compact.
- Create `src/components/admin/dataset-row-detail-dialog.tsx`: render detail fields, completed count, overlap, annotators, agreement, and metric results.
- Modify `tests/e2e/full-flow.spec.ts`: verify list fields stay compact, row detail opens with detail fields, and export returns JSONL.

## Data Contracts

Admin row detail response:

```ts
type DatasetRowDetailResponse = {
  row: {
    id: string;
    internalRowId: number;
    detailFields: Record<string, unknown>;
    completedCount: number;
    targetOverlap: number;
    overlapLabel: string;
    missingCount: number;
    agreement: number | null;
    assignments: Array<{
      id: string;
      status: string;
      annotator: { id: string; name: string | null; image: string | null };
      metrics: Record<string, { label: string; value: string | null; note: string | null }>;
    }>;
  };
};
```

Export line shape:

```ts
type AnnotatedJsonlLine = {
  row_id: number;
  source_id: string | null;
  data: Record<string, unknown>;
  annotation: {
    completed_count: number;
    target_overlap: number;
    agreement: number | null;
    annotated_by: Array<{ id: string; name: string | null }>;
    results: Array<{
      assignment_id: string;
      annotator: { id: string; name: string | null };
      status: string;
      metrics: Record<string, { label: string; value: string | null; note: string | null }>;
    }>;
  };
};
```

## Tasks

### Task 1: Row Shaping Helpers And Tests

**Files:**
- Create: `src/lib/datasets/row-export.ts`
- Create: `tests/datasets/row-export.test.ts`
- Modify: `tests/datasets/run.ts`

- [ ] **Step 1: Write failing row export tests**

Create `tests/datasets/row-export.test.ts`:

```ts
import assert from "node:assert/strict";
import { buildAnnotatedRow, buildRowDetail } from "../../src/lib/datasets/row-export";

const row = {
  id: "row-1",
  internalRowId: 1,
  sourceId: "source-1",
  rawJson: {
    input: "Prompt",
    intent: "intent-a",
    sub_intent: "sub-a",
    group: "group-a",
    severity: "high",
  },
};

const metrics = [
  { id: "metric-1", key: "policy_violation", label: "Vi phạm chính sách" },
  { id: "metric-2", key: "implicit_risk", label: "Mức độ ẩn ý" },
];

const assignments = [
  {
    id: "assignment-1",
    rowId: "row-1",
    annotatorId: "ann-1",
    annotatorName: "Annotator One",
    annotatorImage: null,
    status: "completed",
    targetOverlap: 2,
  },
  {
    id: "assignment-2",
    rowId: "row-1",
    annotatorId: "ann-2",
    annotatorName: "Annotator Two",
    annotatorImage: null,
    status: "assigned",
    targetOverlap: 2,
  },
];

const results = [
  {
    assignmentId: "assignment-1",
    rowId: "row-1",
    annotatorId: "ann-1",
    metricId: "metric-1",
    value: "Pass",
    note: "ok",
  },
];

const detail = buildRowDetail({
  row,
  detailFields: ["input", "intent", "sub_intent", "group", "severity"],
  assignments,
  results,
  metrics,
  agreement: 100,
});

assert.deepEqual(Object.keys(detail.detailFields), ["input", "intent", "sub_intent", "group", "severity"]);
assert.equal(detail.completedCount, 1);
assert.equal(detail.targetOverlap, 2);
assert.equal(detail.overlapLabel, "1/2");
assert.equal(detail.assignments[0].metrics.policy_violation.value, "Pass");
assert.equal(detail.assignments[0].metrics.policy_violation.note, "ok");

const exported = buildAnnotatedRow({
  row,
  assignments,
  results,
  metrics,
  agreement: 100,
});

assert.equal(exported.row_id, 1);
assert.equal(exported.source_id, "source-1");
assert.equal(exported.annotation.completed_count, 1);
assert.equal(exported.annotation.results[0].metrics.policy_violation.label, "Vi phạm chính sách");
```

- [ ] **Step 2: Add test to runner**

Add this import to `tests/datasets/run.ts`:

```ts
import "./row-export.test";
```

- [ ] **Step 3: Run the failing test**

Run: `pnpm run test:datasets`

Expected: fail because `src/lib/datasets/row-export.ts` does not exist.

- [ ] **Step 4: Implement row shaping helpers**

Create `src/lib/datasets/row-export.ts` with exported `buildRowDetail` and `buildAnnotatedRow`. Use `projectFields` and `computeRowProgress`. Group results by assignment id and metric id. Use metric key as the JSON property name.

- [ ] **Step 5: Verify helper tests**

Run: `pnpm run test:datasets`

Expected: pass.

### Task 2: Admin Row Detail And Export APIs

**Files:**
- Create: `src/app/api/datasets/[id]/rows/[rowId]/route.ts`
- Create: `src/app/api/datasets/[id]/export/route.ts`
- Modify: `src/app/api/datasets/[id]/rows/route.ts`

- [ ] **Step 1: Add single row detail API**

Implement `GET /api/datasets/:id/rows/:rowId` guarded by `requireAdmin`. Load dataset, row, annotation metrics, row assignments joined with annotator profile, and annotation results joined through assignments. Return `buildRowDetail(...)`.

- [ ] **Step 2: Add annotated JSONL export API**

Implement `GET /api/datasets/:id/export?format=jsonl` guarded by `requireAdmin`. Load all dataset rows ordered by `internalRowId`, assignments, metrics, and completed results. Return newline-delimited `JSON.stringify(buildAnnotatedRow(...))`.

- [ ] **Step 3: Keep list API list-mode focused**

Leave `/rows` pagination intact. Confirm admin UI can use `fields=list`; do not change default behavior except reusable normalization if needed.

- [ ] **Step 4: Verify APIs compile**

Run: `pnpm run typecheck`

Expected: pass.

### Task 3: Admin Dataset UI

**Files:**
- Modify: `src/app/admin/datasets/[id]/page.tsx`
- Modify: `src/components/admin/dataset-row-table.tsx`
- Create: `src/components/admin/dataset-row-detail-dialog.tsx`

- [ ] **Step 1: Fetch compact list rows**

Change dataset detail page row fetch from:

```ts
fetch(`/api/datasets/${datasetId}/rows?pageSize=200&fields=detail`, { cache: "no-store" })
```

to:

```ts
fetch(`/api/datasets/${datasetId}/rows?pageSize=200&fields=list`, { cache: "no-store" })
```

Pass `detail.dataset.displayConfig.listFields` into `DatasetRowTable`.

- [ ] **Step 2: Make rows clickable**

Add `onRowOpen?: (row: DatasetRow) => void` to `DatasetRowTable`. Table row click calls it. Checkbox click calls `event.stopPropagation()` before toggling.

- [ ] **Step 3: Add row detail dialog**

Create `DatasetRowDetailDialog` that fetches `/api/datasets/${datasetId}/rows/${rowId}` when open. Render detail fields, annotation summary, assignments, metric results, and empty states from the design spec.

- [ ] **Step 4: Add download button**

Add a `Download JSONL` button in the dataset detail header. It should set `window.location.href = /api/datasets/${datasetId}/export?format=jsonl` or create an anchor click. Disable only when dataset has no rows.

- [ ] **Step 5: Verify UI compiles**

Run: `pnpm run typecheck`

Expected: pass.

### Task 4: E2E And Final Verification

**Files:**
- Modify: `tests/e2e/full-flow.spec.ts`

- [ ] **Step 1: Extend admin dataset e2e**

In the existing dataset flow test, after opening dataset detail:

```ts
await expect(page.getByRole("columnheader", { name: "input" })).toBeVisible();
await expect(page.getByRole("columnheader", { name: "label.policy" })).toHaveCount(0);
await page.getByRole("row", { name: /Policy unsafe/ }).click();
await expect(page.getByRole("dialog", { name: /Row 1/ })).toBeVisible();
await expect(page.getByText("label.policy")).toBeVisible();
```

Use exact text from current test fixtures if different.

- [ ] **Step 2: Verify export endpoint in e2e**

Call the endpoint via Playwright request:

```ts
const exportResponse = await page.request.get(`/api/datasets/${dataset.id}/export?format=jsonl`);
expect(exportResponse.ok()).toBeTruthy();
const lines = (await exportResponse.text()).trim().split("\n");
expect(lines.length).toBeGreaterThan(0);
expect(JSON.parse(lines[0]).annotation).toBeTruthy();
```

- [ ] **Step 3: Run local verification**

Run:

```bash
pnpm run typecheck
pnpm run test:datasets
pnpm exec playwright test tests/e2e/full-flow.spec.ts
```

Expected: all pass.

## Herdr Delivery Contract

```yaml
herdr_delivery:
  backend: herdr
  approved_spec:
    path: docs/superpowers/specs/2026-07-29-dataset-row-detail-export-design.md
    digest_command: shasum -a 256 docs/superpowers/specs/2026-07-29-dataset-row-detail-export-design.md
  repository_root: /Users/haido/expert-review
  base_sha_command: git rev-parse HEAD
  plan_acceptance: user approved implementation with "ok implement"
  lanes:
    - lane_id: row-shaping
      role: implementation
      eligible_slots: [P2, P3, P4]
      owned_paths:
        - src/lib/datasets/row-export.ts
        - tests/datasets/row-export.test.ts
        - tests/datasets/run.ts
      prerequisites: []
      dependency_wave: 1
      acceptance:
        - pnpm run test:datasets passes for row export shaping
      terminal_checks:
        - pnpm run test:datasets
    - lane_id: admin-row-apis
      role: implementation
      eligible_slots: [P2, P3, P4]
      owned_paths:
        - src/app/api/datasets/[id]/rows/[rowId]/route.ts
        - src/app/api/datasets/[id]/export/route.ts
        - src/app/api/datasets/[id]/rows/route.ts
      prerequisites:
        - row-shaping accepted
      dependency_wave: 2
      acceptance:
        - Admin row detail endpoint returns detail fields and annotation progress
        - Admin export endpoint returns JSONL and mutates no data
      terminal_checks:
        - pnpm run typecheck
    - lane_id: admin-dataset-ui
      role: implementation
      eligible_slots: [P2, P3, P4]
      owned_paths:
        - src/app/admin/datasets/[id]/page.tsx
        - src/components/admin/dataset-row-table.tsx
        - src/components/admin/dataset-row-detail-dialog.tsx
      prerequisites:
        - admin-row-apis accepted
      dependency_wave: 3
      acceptance:
        - Dataset list uses listFields only
        - Row click opens detail dialog
        - Download JSONL button is available to admin
      terminal_checks:
        - pnpm run typecheck
    - lane_id: e2e-verification
      role: implementation
      eligible_slots: [P2, P3, P4]
      owned_paths:
        - tests/e2e/full-flow.spec.ts
      prerequisites:
        - admin-dataset-ui accepted
      dependency_wave: 4
      acceptance:
        - E2E covers compact list fields, row detail, and JSONL export
      terminal_checks:
        - pnpm exec playwright test tests/e2e/full-flow.spec.ts
  reviews:
    P5:
      applicable: true
      role: integration-owner
      reason: combines API, UI, and e2e lanes in shared tree
    P6:
      applicable: true
      role: integration-reviewer
      reason: read-only code review of data-safety and RBAC
    P7:
      applicable: true
      role: qc
      reason: functional e2e and export contract
    P8:
      applicable: true
      role: designer
      reason: admin row detail modal and table density
    P9:
      applicable: false
      reason: no new persona workflow beyond existing admin and annotator journeys
  deployment:
    topology: no-deployment-target
    verification: local typecheck, dataset tests, and Playwright full-flow
  blocking_severity:
    critical:
      - data loss
      - unauthorized row access
      - export omits annotation values
    high:
      - list/detail field contract violated
      - e2e full flow fails
  required_evidence:
    - accepted lane receipts
    - pnpm run typecheck output
    - pnpm run test:datasets output
    - pnpm exec playwright test tests/e2e/full-flow.spec.ts output
```

