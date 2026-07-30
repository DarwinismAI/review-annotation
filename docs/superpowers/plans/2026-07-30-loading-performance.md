# Loading Performance Implementation Plan

> **For Herdr delivery:** REQUIRED SUB-SKILL: Use
> `herdr-orchestrator` only after this plan is approved.

**Goal:** Make admin/annotator navigation and empty-state loading feel fast on production while preserving annotation data safety.

**Architecture:** Split performance into a client read-through cache/shell lane, an API list-contract lane, and a performance evidence lane. Mutations stay uncached and invalidate affected GET resources explicitly.

**Tech Stack:** Next.js App Router, React client components, TypeScript, Drizzle ORM, Playwright, existing `pnpm` scripts.

---

## Files And Responsibilities

- Create `src/hooks/use-fast-resource.ts`: shared read-only GET cache hook with stale data, refresh state, abort, TTL, and invalidation helpers.
- Modify `src/hooks/use-json-resource.ts`: keep compatibility or delegate to `useFastResource` without breaking existing callers.
- Modify list pages:
  - `src/app/admin/dashboard/page.tsx`
  - `src/app/admin/datasets/page.tsx`
  - `src/app/admin/members/page.tsx`
  - `src/app/admin/rubrics/page.tsx`
  - `src/app/annotator/tasks/page.tsx`
  - `src/components/admin/dataset-import-jobs-panel.tsx`
- Modify API routes:
  - `src/app/api/datasets/route.ts`
  - `src/app/api/annotator/task-groups/route.ts`
  - `src/app/api/annotator/tasks/route.ts`
  - `src/app/api/datasets/[id]/rows/route.ts`
  - `src/app/api/rubrics/route.ts`
  - `src/app/api/admin/members/route.ts`
- Create focused tests:
  - `tests/datasets/fast-resource-contract.test.ts`
  - `tests/datasets/api-list-contracts.test.ts`
  - `tests/e2e/performance-smoke.spec.ts`
- Modify `tests/datasets/run.ts` to include new contract tests.

## Task 1: Client Read-Through Cache And Stable Loading State

**Files:**
- Create: `src/hooks/use-fast-resource.ts`
- Modify: `src/hooks/use-json-resource.ts`
- Test: `tests/datasets/fast-resource-contract.test.ts`
- Modify: `tests/datasets/run.ts`

- [ ] **Step 1: Write the failing hook contract test**

Create `tests/datasets/fast-resource-contract.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/hooks/use-fast-resource.ts", "utf8");

assert.match(source, /const DEFAULT_TTL_MS\s*=\s*30000/);
assert.match(source, /type FastResourceStatus\s*=\s*"idle"\s*\|\s*"loading"\s*\|\s*"ready"\s*\|\s*"refreshing"\s*\|\s*"error"/);
assert.match(source, /export function invalidateFastResource/);
assert.match(source, /AbortController/);
assert.match(source, /cache\.get\(url\)/);
assert.match(source, /setState\(\(current\)/);
```

Add to `tests/datasets/run.ts`:

```ts
import "./fast-resource-contract.test";
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm run test:datasets
```

Expected: fails because `src/hooks/use-fast-resource.ts` does not exist.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/use-fast-resource.ts` with this public surface:

```ts
"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { readJsonResponse } from "./use-json-resource";

export type FastResourceStatus = "idle" | "loading" | "ready" | "refreshing" | "error";

const DEFAULT_TTL_MS = 30000;
const cache = new Map<string, { value: unknown; expiresAt: number }>();

interface FastResourceState<T> {
  data: T;
  error: string | null;
  status: FastResourceStatus;
  isInitialLoading: boolean;
  isRefreshing: boolean;
  reload: () => void;
  setData: Dispatch<SetStateAction<T>>;
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : "Không tải được dữ liệu";
}

export function invalidateFastResource(prefix: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export function clearFastResourceCache() {
  cache.clear();
}

export function useFastResource<T>(url: string, initialData: T, ttlMs = DEFAULT_TTL_MS): FastResourceState<T> {
  const cached = cache.get(url);
  const now = Date.now();
  const hasFreshCache = Boolean(cached && cached.expiresAt > now);
  const [data, setData] = useState<T>(() => (hasFreshCache ? (cached!.value as T) : initialData));
  const [status, setStatus] = useState<FastResourceStatus>(hasFreshCache ? "ready" : "loading");
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const lastUrlRef = useRef(url);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const cachedValue = cache.get(url);
    const fresh = cachedValue && cachedValue.expiresAt > Date.now();

    if (fresh) {
      setData(cachedValue.value as T);
      setStatus("ready");
      setError(null);
    } else {
      setStatus((current) => (current === "ready" || lastUrlRef.current === url ? "refreshing" : "loading"));
    }
    lastUrlRef.current = url;

    async function load() {
      try {
        const response = await fetch(url, {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const payload = await readJsonResponse(response);
        if (!response.ok) throw new Error("Không tải được dữ liệu");
        cache.set(url, { value: payload, expiresAt: Date.now() + ttlMs });
        if (!active) return;
        setData(payload as T);
        setError(null);
        setStatus("ready");
      } catch (loadError) {
        if (!active || controller.signal.aborted) return;
        setError(messageFromError(loadError));
        setStatus("error");
      }
    }

    load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [url, ttlMs, version]);

  const reload = useCallback(() => setVersion((current) => current + 1), []);
  const isInitialLoading = status === "loading";
  const isRefreshing = status === "refreshing";
  return { data, error, status, isInitialLoading, isRefreshing, reload, setData };
}
```

- [ ] **Step 4: Keep compatibility**

Modify `src/hooks/use-json-resource.ts` only if needed so existing callers still receive `{ data, error, loading, reload, setData }`. Do not remove `readJsonResponse`.

- [ ] **Step 5: Verify**

Run:

```bash
pnpm run test:datasets
pnpm run typecheck
```

Expected: both pass.

## Task 2: Convert Primary List Pages To Stable Shell Loading

**Files:**
- Modify `src/app/admin/dashboard/page.tsx`
- Modify `src/app/admin/datasets/page.tsx`
- Modify `src/app/admin/members/page.tsx`
- Modify `src/app/admin/rubrics/page.tsx`
- Modify `src/app/annotator/tasks/page.tsx`
- Modify `src/components/admin/dataset-import-jobs-panel.tsx`

- [ ] **Step 1: Convert imports**

For each listed page, replace:

```ts
import { useJsonResource } from "@/hooks/use-json-resource";
```

with:

```ts
import { useFastResource } from "@/hooks/use-fast-resource";
```

- [ ] **Step 2: Convert hook calls**

Change calls like:

```ts
const { data, error, loading } = useJsonResource<DatasetsPayload>(url, EMPTY_DATASETS);
```

to:

```ts
const { data, error, isInitialLoading, isRefreshing, reload, setData } = useFastResource<DatasetsPayload>(url, EMPTY_DATASETS);
```

Use `isInitialLoading` for first blank state only. Use `isRefreshing` for small inline text or disabled pagination buttons.

- [ ] **Step 3: Preserve data during refresh**

Replace conditions that hide existing lists:

```tsx
{loading && <SkeletonRows />}
{!loading && rows.length === 0 && <EmptyState />}
```

with:

```tsx
{isInitialLoading && rows.length === 0 && <SkeletonRows />}
{!isInitialLoading && rows.length === 0 && <EmptyState />}
{isRefreshing && rows.length > 0 ? <span className="text-xs text-slate-400">Đang cập nhật</span> : null}
```

- [ ] **Step 4: Invalidate after mutations**

Where these pages mutate data and then call `setData`, keep the local optimistic update. Where mutation should refresh from server, call:

```ts
import { invalidateFastResource } from "@/hooks/use-fast-resource";

invalidateFastResource("/api/admin/members");
invalidateFastResource("/api/rubrics");
invalidateFastResource("/api/datasets");
invalidateFastResource("/api/annotator/task-groups");
```

Use only the prefix that matches the mutated resource.

- [ ] **Step 5: Verify**

Run:

```bash
pnpm run typecheck
pnpm exec playwright test tests/e2e/navigation-performance.spec.ts --project=chromium --workers=1
```

Expected: typecheck passes and navigation-performance spec passes.

## Task 3: API List Contract Sweep

**Files:**
- Modify `src/app/api/annotator/task-groups/route.ts`
- Modify `src/app/api/annotator/tasks/route.ts`
- Modify `src/app/api/datasets/[id]/rows/route.ts`
- Inspect `src/app/api/rubrics/route.ts`
- Inspect `src/app/api/admin/members/route.ts`
- Test `tests/datasets/api-list-contracts.test.ts`
- Modify `tests/datasets/run.ts`

- [ ] **Step 1: Write source-level contract tests**

Create `tests/datasets/api-list-contracts.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const taskGroups = readFileSync("src/app/api/annotator/task-groups/route.ts", "utf8");
const annotatorTasks = readFileSync("src/app/api/annotator/tasks/route.ts", "utf8");
const datasetRows = readFileSync("src/app/api/datasets/[id]/rows/route.ts", "utf8");

assert.doesNotMatch(taskGroups, /db\.select\(\)\.from\(annotationAssignments\)/);
assert.match(taskGroups, /groupBy|assignmentRunId|totalCount/);

assert.doesNotMatch(annotatorTasks, /rawJson:\s*datasetRows\.rawJson/);
assert.match(annotatorTasks, /pageSize/);

assert.match(datasetRows, /fields.*list|listFields/);
assert.doesNotMatch(datasetRows, /db\.select\(\)\.from\(datasets\)/);
```

Add to `tests/datasets/run.ts`:

```ts
import "./api-list-contracts.test";
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm run test:datasets
```

Expected: fails where APIs still fetch list-unneeded fields.

- [ ] **Step 3: Optimize annotator task-groups**

Modify `src/app/api/annotator/task-groups/route.ts` so it does not fetch every assignment row just to render the group list. Use grouped DB rows by `assignmentRunId`, `datasetId`, `datasetName`, `metricKey`, and `status` counts. If the DB abstraction makes one exact grouped query awkward across SQLite/Postgres, use a bounded projection with no row JSON and no dataset display config.

The response shape must remain:

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
    status: string;
    assignedAt: string;
  }>;
}
```

- [ ] **Step 4: Optimize annotator tasks list**

Modify `src/app/api/annotator/tasks/route.ts` so the list route does not include `datasetRows.rawJson` unless the UI actually uses row field previews. If current task list only shows task group cards, keep this route compatible but light. If it is unused, leave response shape compatible and add a comment explaining the detail route owns full row JSON.

- [ ] **Step 5: Optimize dataset rows list**

Modify `src/app/api/datasets/[id]/rows/route.ts` to select only:

```ts
{
  id: datasetRows.id,
  internalRowId: datasetRows.internalRowId,
  rawJson: datasetRows.rawJson,
}
```

Select dataset metadata explicitly:

```ts
{
  id: datasets.id,
  displayConfig: datasets.displayConfig,
}
```

Do not use `db.select().from(datasets)`.

- [ ] **Step 6: Verify**

Run:

```bash
pnpm run test:datasets
pnpm run typecheck
pnpm exec playwright test tests/e2e/full-flow.spec.ts --project=chromium --workers=1
```

Expected: all pass.

## Task 4: Performance Smoke Evidence

**Files:**
- Create `tests/e2e/performance-smoke.spec.ts`
- Modify `package.json` if adding a script is cleaner

- [ ] **Step 1: Add Playwright performance smoke**

Create `tests/e2e/performance-smoke.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";

async function measureNav(page: Page, label: string) {
  const start = Date.now();
  await page.getByRole("link", { name: label }).click();
  await expect(page.getByRole("heading").first()).toBeVisible();
  return Date.now() - start;
}

test("admin navigation gives quick visible feedback", async ({ page }, testInfo) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.E2E_ADMIN_EMAIL ?? "admin@review-annotation.local");
  await page.getByLabel("Mật khẩu").fill(process.env.E2E_ADMIN_PASSWORD ?? "local-dev-password");
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL(/\/admin/);

  const timings = {
    datasets: await measureNav(page, "Datasets"),
    members: await measureNav(page, "Thành viên"),
    rubrics: await measureNav(page, "Rubric"),
    dashboard: await measureNav(page, "Tổng quan"),
  };

  await testInfo.attach("navigation-timings", {
    body: JSON.stringify(timings, null, 2),
    contentType: "application/json",
  });

  for (const value of Object.values(timings)) {
    expect(value).toBeLessThan(1500);
  }
});
```

The hard assertion is intentionally loose for CI stability. The attached timings are the real evidence used for tuning.

- [ ] **Step 2: Run local performance smoke**

Run:

```bash
pnpm exec playwright test tests/e2e/performance-smoke.spec.ts --project=chromium --workers=1
```

Expected: passes and writes timing attachment.

- [ ] **Step 3: Add dev persona instructions**

Document in the test or a small helper comment that dev tests must not run against `cxzharry-8988s-projects`; if only that deployment is available, the test reports a blocker.

- [ ] **Step 4: Verify navigation and full-flow**

Run:

```bash
pnpm exec playwright test tests/e2e/navigation-performance.spec.ts tests/e2e/full-flow.spec.ts tests/e2e/performance-smoke.spec.ts --project=chromium --workers=1
```

Expected: all selected specs pass.

## Task 5: Integration, Review, And Push

**Files:**
- Git index
- `origin/dev`
- `origin/main`

- [ ] **Step 1: Review diff scope**

Run:

```bash
git status --short
git diff --stat
git diff --check
```

Expected: only files named in this plan are modified and `git diff --check` exits 0.

- [ ] **Step 2: Run full verification**

Run:

```bash
pnpm run typecheck
pnpm run test:datasets
pnpm exec playwright test tests/e2e/navigation-performance.spec.ts tests/e2e/full-flow.spec.ts tests/e2e/performance-smoke.spec.ts --project=chromium --workers=1
pnpm run build
```

Expected: all pass.

- [ ] **Step 3: Commit**

Run:

```bash
git add src/hooks src/app/admin src/app/annotator src/app/api tests package.json docs/superpowers/specs/2026-07-30-loading-performance-design.md docs/superpowers/plans/2026-07-30-loading-performance.md
git commit -m "perf: improve list loading responsiveness"
```

- [ ] **Step 4: Push**

Run:

```bash
git push origin HEAD:refs/heads/dev HEAD:refs/heads/main
git ls-remote origin refs/heads/dev refs/heads/main
```

Expected: both refs point to the new commit.

## Task 6: Dev Persona Test

**Files:**
- Evidence under `test-results/performance-dev-persona-*`

- [ ] **Step 1: Resolve deployment**

Use GitHub/Vercel metadata to find the dev deployment for the pushed commit. If the only deployment is under `cxzharry-8988s-projects`, stop and write a blocker report.

- [ ] **Step 2: Run persona smoke**

Use secure persona credentials without printing secrets. Exercise:

- superadmin/admin: Dashboard, Datasets, Members, Rubric
- annotator: Task list and one task detail if assigned

- [ ] **Step 3: Record evidence**

Record:

- screenshots
- console errors
- network failures
- timing JSON
- deployment URL or blocker

## Herdr Delivery Contract

```yaml
herdr_delivery:
  backend: herdr
  repository_root: /Users/haido/worktrees/expert-review-annotation-queue
  base_sha: b54d0e274165d330eda8f5c1fed7296b395f6c1d
  plan_acceptance: awaits explicit approval of this saved plan before dispatch
  lanes:
    - lane_id: client_shell_cache
      role: implementation
      display_role: impl
      display_slug: fast-resource
      eligible_slots: [P2, P3, P4]
      owned_paths:
        - src/hooks/use-fast-resource.ts
        - src/hooks/use-json-resource.ts
        - src/app/admin/dashboard/page.tsx
        - src/app/admin/datasets/page.tsx
        - src/app/admin/members/page.tsx
        - src/app/admin/rubrics/page.tsx
        - src/app/annotator/tasks/page.tsx
        - src/components/admin/dataset-import-jobs-panel.tsx
        - tests/datasets/fast-resource-contract.test.ts
        - tests/datasets/run.ts
      prerequisites: []
      acceptance:
        - read-only GET resources keep stale data during refresh
        - list pages do not blank after cached data exists
        - mutations invalidate affected read-resource prefixes
      terminal_checks:
        - pnpm run test:datasets
        - pnpm run typecheck
    - lane_id: api_list_contracts
      role: implementation
      display_role: impl
      display_slug: api-lists
      eligible_slots: [P2, P3, P4]
      owned_paths:
        - src/app/api/datasets/route.ts
        - src/app/api/annotator/task-groups/route.ts
        - src/app/api/annotator/tasks/route.ts
        - src/app/api/datasets/[id]/rows/route.ts
        - src/app/api/rubrics/route.ts
        - src/app/api/admin/members/route.ts
        - tests/datasets/api-list-contracts.test.ts
        - tests/datasets/run.ts
      prerequisites: []
      acceptance:
        - list APIs avoid heavy JSON/default aggregate queries
        - response shapes remain compatible with existing UI
        - annotation mutation/save routes are untouched
      terminal_checks:
        - pnpm run test:datasets
        - pnpm run typecheck
    - lane_id: perf_evidence
      role: implementation
      display_role: impl
      display_slug: perf-smoke
      eligible_slots: [P2, P3, P4]
      owned_paths:
        - tests/e2e/performance-smoke.spec.ts
        - package.json
        - playwright-report/**
        - test-results/**
      prerequisites: [client_shell_cache, api_list_contracts]
      acceptance:
        - local performance smoke captures navigation timings
        - test records deployment blocker when only cxzharry project is exposed
      terminal_checks:
        - pnpm exec playwright test tests/e2e/performance-smoke.spec.ts --project=chromium --workers=1
    - lane_id: integration_push
      role: integration-owner
      display_role: integ
      display_slug: perf-push
      eligible_slots: [P5]
      owned_paths:
        - git index
        - origin refs/heads/dev
        - origin refs/heads/main
      prerequisites: [client_shell_cache, api_list_contracts, perf_evidence]
      acceptance:
        - integrated diff passes full verification
        - one coherent performance commit pushed to dev and main
      terminal_checks:
        - git diff --check
        - pnpm run typecheck
        - pnpm run test:datasets
        - pnpm exec playwright test tests/e2e/navigation-performance.spec.ts tests/e2e/full-flow.spec.ts tests/e2e/performance-smoke.spec.ts --project=chromium --workers=1
        - pnpm run build
        - git ls-remote origin refs/heads/dev refs/heads/main
    - lane_id: persona_dev_test
      role: persona-qc
      display_role: persona
      display_slug: perf-dev
      eligible_slots: [P9]
      owned_paths:
        - test-results/**
        - playwright-report/**
      prerequisites: [integration_push]
      acceptance:
        - persona test runs on correct dev deployment or records precise deployment blocker
        - admin/superadmin/annotator navigation UX and errors are reported
      terminal_checks:
        - browser evidence or explicit deployment blocker
  reviews:
    P5: {applicable: true, role: integration-owner}
    P6: {applicable: true, role: integration-reviewer}
    P7: {applicable: true, reason: performance regression matrix}
    P8: {applicable: false, reason: no visual redesign beyond loading states}
    P9: {applicable: true, reason: user requested persona dev validation}
  deployment:
    topology: github branches trigger Vercel dev and prod
    verification: local full checks plus dev persona evidence after deploy
```

## Self-Review

- Spec coverage: client shell, API list contracts, perf evidence, data safety, and dev persona blocker all map to tasks.
- Completion scan: every task contains concrete implementation and verification instructions.
- Type consistency: `useFastResource`, `invalidateFastResource`, and `FastResourceStatus` names are consistent across tasks.
