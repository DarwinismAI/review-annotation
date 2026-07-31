# API Fast Path And Admin Row Navigation Implementation Plan

> **For Herdr delivery:** REQUIRED SUB-SKILL: Use
> `herdr-orchestrator` only after this plan is approved.

**Goal:** Reduce warmed direct hot-read API p95 toward 150 ms without weakening authorization or annotation persistence, fix the six reviewed correctness and security findings, and add safe Previous, Next, Save, and Save & next controls to the admin row-review screen.

**Architecture:** Keep the existing Next.js, Supabase Auth, PostgreSQL, Drizzle, and Vercel stack. Co-locate functions with PostgreSQL, verify asymmetric Supabase JWTs through `getClaims()`, read roles directly from PostgreSQL, collapse repeated query waves, namespace the browser read cache by authenticated user, and keep every mutation uncached and transactional.

**Tech Stack:** Next.js 15 App Router, React, TypeScript, Supabase Auth, PostgreSQL, Drizzle ORM, postgres.js, Vercel Functions, Playwright, `tsx`.

---

## Source Of Truth

- Approved design: `docs/superpowers/specs/2026-07-31-api-fast-path-admin-row-navigation-design.md`
- Architecture graph: `docs/architecture/review-annotation-api-performance.excalidraw`
- Baseline evidence: `test-results/prod-performance-qc-20260730T081006Z/summary.md`
- Plan base SHA: `ed5ac2e9b2a7fb03a271e42970fe2c746ad84ac3`
- Approved design SHA256: `6da5c12ca5c64a02ea8cae1c7aac4e7d677d050b470cdb9caff26f596301de1b`

## Locked Constraints

- Do not add Redis, Vercel KV, a queue, a custom session service, or a new backend.
- Do not trust a decoded but unverified JWT.
- Do not trust a browser-supplied role; `profiles.role` remains authoritative.
- Do not cache draft, submit, skip, assignment, import, adjudication, role mutation, or export generation.
- Do not overwrite annotator results with adjudication values.
- Do not alter assignment overlap or annotator random-next semantics.
- Do not add random navigation to the admin row screen.
- Do not expose credentials, cookies, token payloads, user identifiers, SQL values, or connection strings in logs or evidence.
- Do not change dev or production deployment configuration until region and signing-key diagnostics are recorded.
- Do not deploy production until migration, data-integrity, role, browser, and performance gates pass on dev.

## Success Gates

- `annotation_adjudications` has RLS enabled and direct `anon` and `authenticated` privileges revoked.
- Production indexes are created concurrently outside the migration transaction.
- Missing, expired, malformed, or unverified tokens return `401`; unauthorized roles return `403`.
- A same-tab account switch cannot display cached data from the previous user.
- Dataset search and completion filters apply before pagination and return the filtered total.
- A page label always matches the rows currently displayed.
- Admin row detail uses one GET, returns adjudication plus filtered Previous and Next neighbors, and does not lose unsaved edits.
- `Lưu & câu tiếp` navigates only after persisted adjudication is returned successfully.
- Existing annotation draft, submit, skip, assign, import, role change, export, and logout flows remain functional.
- Warmed direct hot-read API p95 target is at most 150 ms; cold-start results are reported separately.
- No 5xx, JSON parse errors, browser page errors, console errors, or persistence regressions in the three-role persona suite.

## Task 1: Lock Security And Migration Safety

**Owner lane:** `security-auth-fast-path`

**Files:**
- Modify: `migrations/0022_annotation_queue_adjudication.sql`
- Create: `migrations/0023_annotation_adjudication_security.sql`
- Modify: `scripts/apply-annotation-queue-migration.ts`
- Create: `tests/datasets/annotation-adjudication-security.test.ts`
- Modify later by integration lane only: `tests/datasets/run.ts`

- [ ] **Step 1: Add failing migration contract tests**

Create `tests/datasets/annotation-adjudication-security.test.ts` with source-level assertions that:

```ts
assert.match(securitySql, /ALTER TABLE public\.annotation_adjudications ENABLE ROW LEVEL SECURITY/i);
assert.match(securitySql, /REVOKE ALL ON TABLE public\.annotation_adjudications FROM anon, authenticated/i);
assert.doesNotMatch(transactionalSql, /CREATE\s+(UNIQUE\s+)?INDEX(?!\s+CONCURRENTLY)/i);
assert.match(runnerSource, /CREATE INDEX CONCURRENTLY IF NOT EXISTS/i);
assert.match(runnerSource, /verifyAdjudicationSecurity/);
```

The test must also assert that concurrent index SQL is not passed to `client.begin()`.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
pnpm exec tsx tests/datasets/annotation-adjudication-security.test.ts
```

Expected: failure because the security migration and concurrent-index phase do not exist.

- [ ] **Step 3: Separate transactional DDL from concurrent indexes**

Keep table, columns, foreign keys, and unique constraints in the transactional phase. Remove ordinary index creation from `0022` where the same index can be built by the runner after commit.

Create `0023_annotation_adjudication_security.sql` as an idempotent transactional security migration:

```sql
ALTER TABLE public.annotation_adjudications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.annotation_adjudications FROM anon, authenticated;
```

In `scripts/apply-annotation-queue-migration.ts`, define the exact concurrent statements in code so they run individually after `client.begin()` has completed:

```ts
const CONCURRENT_INDEX_SQL = [
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS annotation_assignments_group_queue_idx
     ON public.annotation_assignments (annotator_id, assignment_run_id, status, skipped_at, assigned_at)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS dataset_imports_dataset_status_idx
     ON public.dataset_imports (dataset_id, status, created_at DESC)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS annotation_adjudications_dataset_row_idx
     ON public.annotation_adjudications (dataset_id, row_id)`,
] as const;
```

Do not duplicate the unique constraint as a separate concurrent unique index. PostgreSQL already creates its backing index.

- [ ] **Step 4: Verify catalog, privileges, and row-count invariants**

Add `verifyAdjudicationSecurity()` to query `pg_class.relrowsecurity` and `information_schema.role_table_grants`. The runner must fail unless RLS is enabled and neither `anon` nor `authenticated` retains direct table privileges.

Preserve the existing before/after row-count checks. Run concurrent index statements only after the transactional migration and count checks commit, then run final catalog and security verification.

- [ ] **Step 5: Verify the lane**

Run:

```bash
pnpm exec tsx tests/datasets/annotation-adjudication-security.test.ts
pnpm run typecheck
git diff --check
```

Expected: all pass. Do not run the production migration from this lane.

- [ ] **Step 6: Commit the lane**

```bash
git add migrations/0022_annotation_queue_adjudication.sql \
  migrations/0023_annotation_adjudication_security.sql \
  scripts/apply-annotation-queue-migration.ts \
  tests/datasets/annotation-adjudication-security.test.ts
git commit -m "fix: secure adjudications and build indexes safely"
```

## Task 2: Build The Verified Auth Fast Path And Request Timings

**Owner lane:** `security-auth-fast-path`

**Files:**
- Modify: `src/lib/supabase/server.ts`
- Modify: `src/lib/auth-middleware.ts`
- Modify if needed to remove duplicate session work: `src/lib/auth.ts`
- Create: `src/lib/request-timing.ts`
- Create: `scripts/diagnose-runtime-topology.ts`
- Create: `tests/datasets/auth-fast-path.test.ts`
- Create: `tests/datasets/request-timing.test.ts`
- Modify only after recorded evidence: `vercel.json`
- Modify later by integration lane only: `tests/datasets/run.ts`

- [ ] **Step 1: Write failing auth and timing tests**

The tests must cover:

- local development role-cookie behavior remains unchanged;
- production auth invokes `getClaims()`, not `getUser()`;
- claim subject is required and must be a UUID;
- `profiles` is read through the existing Drizzle/PostgreSQL connection;
- an absent profile yields no session;
- `resolveEffectiveRole()` still applies;
- `Server-Timing` contains only `auth`, `profile`, `sql`, and `total` durations;
- timing values are non-negative numbers and descriptions contain no request data.

Run:

```bash
pnpm exec tsx tests/datasets/auth-fast-path.test.ts
pnpm exec tsx tests/datasets/request-timing.test.ts
```

Expected: both fail before implementation.

- [ ] **Step 2: Add a small request timing helper**

Create a request-scoped helper with no global mutable timing state:

```ts
export interface RequestTiming {
  measure<T>(phase: "auth" | "profile" | "sql", work: () => Promise<T>): Promise<T>;
  header(): string;
}

export function createRequestTiming(now = performance.now): RequestTiming;
```

`header()` must produce a valid `Server-Timing` value and include `total`. Add the header in the auth wrapper to every protected route response, including `401` and `403`.

Extend the existing resolved route context compatibly:

```ts
interface ResolvedContext {
  params: Record<string, string>;
  timing: RequestTiming;
}
```

The wrapper creates one timer, passes it to the handler, waits for the response, and then appends `Server-Timing`. Hot routes in Task 3 wrap their actual database work in `context.timing.measure("sql", ...)`; do not label the entire handler as SQL time.

- [ ] **Step 3: Replace remote user and profile round-trips**

In the shared production session helper:

1. Create the cookie-bound Supabase client.
2. Call `supabase.auth.getClaims()`.
3. Reject a missing error-free claim set, missing `sub`, or malformed UUID.
4. Query `profiles` through `db.select()` by `profiles.id`.
5. Return the existing `AppSession` / guarded-session shape.

Keep authorization wrappers unchanged at their public surface so route handlers do not need broad edits.

The implementation must not fall back to unverified token decoding. If diagnostics show a symmetric signing key, leave the prior verified path active and report the signing-key gate instead of shipping an unsafe shortcut.

- [ ] **Step 4: Diagnose topology without secrets**

Create `scripts/diagnose-runtime-topology.ts` that records:

- Vercel deployment URL and branch label supplied by non-secret arguments;
- `x-vercel-id` / function region from a safe authenticated probe;
- Supabase database region from approved project metadata or connection-host metadata;
- JWT algorithm name only;
- whether public JWKS is available;
- request `Server-Timing` phases.

The script must redact query strings, authorization headers, cookies, database URLs, and user identifiers. Save evidence under a UTC-stamped directory such as `test-results/api-fast-path-20260731T120000Z/topology.json`.

- [ ] **Step 5: Pin one Vercel region only after evidence**

If dev and production diagnostics confirm the same Supabase database region, create or modify `vercel.json` with the nearest supported Vercel function region:

Set the single `regions` entry to the literal nearest-region value recorded by Step 4. Do not leave a symbolic value in the committed JSON. If dev and production databases differ, stop this config change and record the mismatch for integration review.

- [ ] **Step 6: Verify auth behavior**

Run:

```bash
pnpm exec tsx tests/datasets/auth-fast-path.test.ts
pnpm exec tsx tests/datasets/request-timing.test.ts
pnpm run typecheck
pnpm run build
git diff --check
```

Expected: all pass. Save the topology evidence path in the lane receipt.

- [ ] **Step 7: Commit the lane**

```bash
git add src/lib/supabase/server.ts src/lib/auth-middleware.ts src/lib/auth.ts \
  src/lib/request-timing.ts scripts/diagnose-runtime-topology.ts \
  tests/datasets/auth-fast-path.test.ts tests/datasets/request-timing.test.ts \
  vercel.json
git commit -m "perf: add verified auth fast path"
```

Omit unchanged or nonexistent optional files from `git add`.

## Task 3: Collapse Hot Read APIs

**Owner lane:** `api-read-queries`

**Files:**
- Modify: `src/app/api/datasets/route.ts`
- Modify: `src/app/api/datasets/[id]/rows/route.ts`
- Modify: `src/app/api/datasets/[id]/rows/[rowId]/route.ts`
- Modify: `src/app/api/admin/members/route.ts`
- Modify: `src/app/api/rubrics/route.ts`
- Create: `src/app/api/admin/dashboard/route.ts`
- Create: `src/lib/datasets/admin-row-query.ts`
- Create: `tests/datasets/dataset-query-contracts.test.ts`
- Create: `tests/datasets/admin-row-navigation.test.ts`
- Modify later by integration lane only: `tests/datasets/run.ts`

- [ ] **Step 1: Add failing query contract tests**

Tests must prove:

- dataset list performs one bounded business query for page rows plus page counts;
- dashboard uses one endpoint rather than client fan-out;
- row list places `search` and completion predicates inside the SQL before `LIMIT` and `OFFSET`;
- row-list `total` represents the filtered set;
- row detail includes `adjudications` and `navigation`;
- row detail no longer requires a second adjudication GET;
- Previous and Next use `internalRowId ASC` and the active search/completion filter;
- members and rubrics each retain one business query.

Use pure query-builder tests for filter semantics and narrow source-contract tests only where the database abstraction is difficult to isolate.

Run:

```bash
pnpm exec tsx tests/datasets/dataset-query-contracts.test.ts
pnpm exec tsx tests/datasets/admin-row-navigation.test.ts
```

Expected: both fail.

- [ ] **Step 2: Collapse the dataset list**

Replace the current page/total/count/latest-import waves with one bounded PostgreSQL CTE or equivalent statement. The shape returned to existing callers remains:

```ts
{
  datasets: DatasetListItem[];
  page: number;
  pageSize: number;
  total: number;
  summary?: DatasetSummary;
}
```

Only aggregate counts for the selected page. Do not select row JSON or detail-field values.

- [ ] **Step 3: Add one dashboard snapshot endpoint**

Create `GET /api/admin/dashboard` under `requireAdmin`. Return:

```ts
interface AdminDashboardSnapshot {
  totals: {
    datasets: number;
    rows: number;
    metrics: number;
    activeAnnotators: number;
  };
  recentDatasets: DatasetListItem[];
}
```

Use one authentication evaluation and one bounded SQL statement. Do not proxy or internally fetch other API routes.

- [ ] **Step 4: Filter rows before pagination**

Build a normalized filter object:

```ts
interface DatasetRowFilters {
  search: string;
  completion: "all" | "complete" | "incomplete";
}
```

Pass it to a query builder that produces:

1. a filtered row CTE;
2. `count(*) over()` as filtered total;
3. page selection after filtering;
4. progress/agreement aggregation for selected row IDs only.

Keep list-field projection separate from detail fields.

- [ ] **Step 5: Return row detail, adjudication, and neighbors together**

`GET /api/datasets/:id/rows/:rowId` must:

1. load dataset metadata and validate the row in one query;
2. start independent metric, assignment/result, adjudication, and neighbor queries in parallel;
3. return:

```ts
{
  row: RowDetail;
  adjudications: Array<{
    metricId: string;
    value: string | null;
    note: string | null;
  }>;
  navigation: {
    previousRowId: string | null;
    nextRowId: string | null;
    position: number;
    filteredTotal: number;
  };
}
```

Parse the same `search` and completion parameters as the list route. Reject a row that is not in the filtered result instead of returning unrelated neighbors.

- [ ] **Step 6: Measure before adding indexes**

Run `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for the five hot business queries against dev-like data. Add a new index only when the plan shows a sequential scan or sort that materially dominates the query. Any new production index must be added to the concurrent phase from Task 1.

- [ ] **Step 7: Verify response compatibility**

Run:

```bash
pnpm exec tsx tests/datasets/dataset-query-contracts.test.ts
pnpm exec tsx tests/datasets/admin-row-navigation.test.ts
pnpm run typecheck
pnpm run build
git diff --check
```

Expected: all pass.

- [ ] **Step 8: Commit the lane**

```bash
git add src/app/api/datasets/route.ts \
  'src/app/api/datasets/[id]/rows/route.ts' \
  'src/app/api/datasets/[id]/rows/[rowId]/route.ts' \
  src/app/api/admin/members/route.ts src/app/api/rubrics/route.ts \
  src/app/api/admin/dashboard/route.ts src/lib/datasets/admin-row-query.ts \
  tests/datasets/dataset-query-contracts.test.ts \
  tests/datasets/admin-row-navigation.test.ts
git commit -m "perf: collapse hot read queries"
```

## Task 4: Scope Client Cache And Stabilize Pagination

**Owner lane:** `client-admin-navigation`

**Files:**
- Modify: `src/hooks/use-fast-resource.ts`
- Modify: `src/lib/auth-client.ts`
- Modify: `src/components/app-shell.tsx`
- Modify: `src/components/app-header.tsx`
- Modify: `src/app/admin/dashboard/dashboard-data-region.tsx`
- Modify: `src/app/admin/datasets/page.tsx`
- Create: `src/components/fast-resource-session.tsx`
- Create: `tests/datasets/fast-resource-session.test.ts`
- Create: `tests/datasets/dataset-page-state.test.ts`
- Modify later by integration lane only: `tests/datasets/run.ts`

- [ ] **Step 1: Add failing cache and page-state tests**

Tests must prove:

- cache keys include authenticated `userId` plus URL;
- session replacement clears all prior entries;
- successful sign-in and sign-out clear the cache;
- a failed page N+1 fetch keeps both page N rows and page N label;
- dashboard calls only `/api/admin/dashboard`.

Run:

```bash
pnpm exec tsx tests/datasets/fast-resource-session.test.ts
pnpm exec tsx tests/datasets/dataset-page-state.test.ts
```

Expected: both fail.

- [ ] **Step 2: Add a session namespace to the read cache**

Keep the module cache private. Add this public surface:

```ts
export function setFastResourceSession(userId: string | null): void;
export function clearFastResourceCache(): void;
```

Build internal keys as `${sessionId ?? "anonymous"}:${url}`. When the namespace changes, clear the entire cache before accepting the new identity.

Mount `FastResourceSession` once inside `AppShell`, passing the authoritative server `session.userId`. Do not put token values in React state.

- [ ] **Step 3: Clear cache across auth transitions**

Call `clearFastResourceCache()`:

- before starting a new password sign-in;
- after a successful local or Supabase sign-in;
- before sign-out;
- after sign-out completes, even when sign-out reports an error.

Keep router redirect and refresh behavior in `AppHeader`.

- [ ] **Step 4: Separate requested and displayed pagination**

In the datasets page, keep:

```ts
const [requestedPage, setRequestedPage] = useState(1);
const displayedPage = data.page;
```

Render the label and rows from the same successful response. While a new request is refreshing, retain the previous response. On error, show a retry affordance but do not relabel stale rows.

- [ ] **Step 5: Switch dashboard to the snapshot endpoint**

`dashboard-data-region.tsx` must make one resource request to `/api/admin/dashboard`. Preserve the existing visual structure; do not add cards or animation as part of this performance task.

- [ ] **Step 6: Verify the lane**

Run:

```bash
pnpm exec tsx tests/datasets/fast-resource-session.test.ts
pnpm exec tsx tests/datasets/dataset-page-state.test.ts
pnpm run typecheck
pnpm run build
git diff --check
```

Expected: all pass.

- [ ] **Step 7: Commit the lane**

```bash
git add src/hooks/use-fast-resource.ts src/lib/auth-client.ts \
  src/components/app-shell.tsx src/components/app-header.tsx \
  src/components/fast-resource-session.tsx \
  src/app/admin/dashboard/dashboard-data-region.tsx \
  src/app/admin/datasets/page.tsx \
  tests/datasets/fast-resource-session.test.ts \
  tests/datasets/dataset-page-state.test.ts
git commit -m "fix: scope read cache to the active user"
```

## Task 5: Add Safe Admin Row Navigation

**Owner lane:** `client-admin-navigation`

**Files:**
- Modify: `src/app/admin/datasets/[id]/rows/[rowId]/page.tsx`
- Modify: `src/components/admin/adjudication-panel.tsx`
- Create: `src/lib/datasets/admin-row-navigation.ts`
- Create: `tests/datasets/admin-row-navigation-ui.test.ts`
- Modify later by integration lane only: `tests/datasets/run.ts`

- [ ] **Step 1: Add failing state-machine tests**

Cover:

- clean Previous and Next navigation;
- dirty Previous, Next, Back, and browser unload guard;
- cancel discard keeps the current row and values;
- save failure preserves values and current route;
- `Lưu & câu tiếp` waits for successful persistence;
- keyboard shortcuts are ignored inside input and textarea elements;
- no navigation beyond filtered boundaries.

Run:

```bash
pnpm exec tsx tests/datasets/admin-row-navigation-ui.test.ts
```

Expected: failure before implementation.

- [ ] **Step 2: Consume one row-detail response**

Remove the duplicate adjudication GET. Request the row endpoint with the preserved list context:

```ts
const query = new URLSearchParams({
  search,
  completion,
});
fetch(`/api/datasets/${datasetId}/rows/${rowId}?${query}`, { cache: "no-store" });
```

Initialize row data, adjudication values, and navigation from this one response.

- [ ] **Step 3: Make adjudication save explicit**

Change the panel callback contract to return persisted values:

```ts
interface AdjudicationPanelProps {
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: (result: PersistedAdjudication[]) => void;
  onSaveAndNext?: (result: PersistedAdjudication[]) => void;
  hasNext: boolean;
}
```

The panel owns form edits. It clears dirty state only after a successful `2xx` response with persisted adjudication values. It renders `Lưu` and `Lưu & câu tiếp`; both are disabled while saving.

- [ ] **Step 4: Add compact navigation controls**

Use Lucide `ChevronLeft` and `ChevronRight` icon buttons with tooltips and accessible labels. Show `position / filteredTotal`, plus the existing back command. Preserve `from`, `search`, and completion filter in every generated URL.

Prefetch `nextRowId` through `router.prefetch()` after the current row is ready. Do not prefetch when no next row exists.

- [ ] **Step 5: Guard dirty navigation**

Use one small helper in `src/lib/datasets/admin-row-navigation.ts` for:

- deciding whether an event target accepts text input;
- constructing a row URL with preserved filters;
- deciding whether confirmation is required.

Use `window.confirm()` only when values are dirty. Add `beforeunload` only while dirty and remove it on cleanup. Handle `Alt+Left` and `Alt+Right` outside editable controls.

- [ ] **Step 6: Verify the lane**

Run:

```bash
pnpm exec tsx tests/datasets/admin-row-navigation-ui.test.ts
pnpm run typecheck
pnpm run build
git diff --check
```

Expected: all pass.

- [ ] **Step 7: Commit the lane**

```bash
git add 'src/app/admin/datasets/[id]/rows/[rowId]/page.tsx' \
  src/components/admin/adjudication-panel.tsx \
  src/lib/datasets/admin-row-navigation.ts \
  tests/datasets/admin-row-navigation-ui.test.ts
git commit -m "feat: navigate admin dataset rows safely"
```

## Task 6: Integrate Tests, Benchmarks, And Branches

**Owner lane:** `integration-evidence`

**Prerequisite:** Tasks 1 through 5 have terminal receipts and commits.

**Files:**
- Modify: `tests/datasets/run.ts`
- Modify: `tests/e2e/annotation-queue.spec.ts`
- Modify: `tests/e2e/full-flow.spec.ts`
- Modify: `tests/e2e/navigation-performance.spec.ts`
- Modify: `tests/e2e/performance-smoke.spec.ts`
- Modify: `scripts/benchmark-navigation-performance.ts`
- Create: `scripts/verify-annotation-persistence.ts`
- Create evidence only under: `test-results/api-fast-path-*/`

- [ ] **Step 1: Integrate lane commits and resolve only owned conflicts**

Apply the accepted lane commits onto the integration branch. Reject changes outside each lane's owned paths. Run:

```bash
git diff --check
git status --short
```

Expected: no unresolved conflicts or untracked secrets.

- [ ] **Step 2: Wire focused tests into the dataset runner**

Import every new `tests/datasets/*.test.ts` file exactly once in `tests/datasets/run.ts`. Run:

```bash
pnpm run test:datasets
pnpm run typecheck
pnpm run build
```

Expected: all pass.

- [ ] **Step 3: Add persistence evidence**

Create `scripts/verify-annotation-persistence.ts` to:

1. create or identify isolated seeded assignment and adjudication rows;
2. record primary keys, status, metric keys, values, notes, and timestamps before the flow;
3. execute draft, reload, submit, skip, and adjudication flows through authenticated APIs;
4. read the rows directly from PostgreSQL;
5. compare the expected values;
6. clean up only records created by the script.

The artifact must hash user identifiers and redact credentials. A mismatch exits non-zero.

- [ ] **Step 4: Strengthen E2E readiness**

Update performance tests to wait for API-backed content, not route shell headings. Measure:

- cold first request after a fresh deployment;
- ten direct `cache: no-store` requests per hot endpoint after warm-up;
- visible click-to-feedback time;
- API completion time;
- `Server-Timing` auth, profile, sql, and total phases.

Fail on page errors, console errors, non-JSON 2xx responses, `5xx`, or missing API-backed content.

- [ ] **Step 5: Run the real dev persona suite**

On the dev deployment, run:

```bash
pnpm exec playwright test tests/e2e/full-flow.spec.ts --project=chromium
pnpm exec playwright test tests/e2e/annotation-queue.spec.ts --project=chromium
pnpm exec playwright test tests/e2e/navigation-performance.spec.ts --project=chromium
pnpm exec playwright test tests/e2e/performance-smoke.spec.ts --project=chromium
pnpm exec tsx scripts/verify-annotation-persistence.ts --target=dev
pnpm run benchmark:navigation -- --target=dev --runs=10
```

Required personas:

- superadmin: role management, dataset row review, adjudication, Save & next, logout;
- admin: create/import, assign, filter, row review, annotator-result inspection, adjudication, export, logout;
- annotator: task list, draft, reload, submit, skip, random next, logout;
- same-tab account switch between two roles.

Expected: all flows pass and persistence verification exits zero.

- [ ] **Step 6: Review evidence against the gate**

Write the UTC-stamped run summary, for example `test-results/api-fast-path-20260731T120000Z/summary.md`, containing:

- branch, commit, deployment URL, Vercel region, database region;
- cold duration separately;
- warm p50, p95, maximum, response bytes, and timing phases per endpoint;
- persona and persistence outcomes;
- remaining endpoint over 150 ms with its dominant timing phase.

Do not call the target met if only client-cached or shell timings are below 150 ms.

- [ ] **Step 7: Commit integration changes**

```bash
git add tests/datasets/run.ts tests/e2e scripts/benchmark-navigation-performance.ts \
  scripts/verify-annotation-persistence.ts
git commit -m "test: verify API latency and annotation persistence"
```

Do not commit credentials, authenticated storage state, raw database output, or large Playwright artifacts.

## Task 7: Independent Review And Quality Gates

**Owners:** `code-review`, `quality-control`, `design-review`, `persona-testing`

- [ ] **Step 1: P6 code review**

Review security, data loss, auth correctness, transaction boundaries, race conditions, filter semantics, cache isolation, migration safety, and missing tests. Findings lead the receipt and include file/line references. Any blocking finding returns the work to the owning implementation lane.

- [ ] **Step 2: P7 quality-control**

Run the full focused suite, typecheck, production build, migration dry-run/catalog checks against a disposable database, direct API benchmark, and persistence verifier. Confirm no result count or persisted value changes outside isolated fixtures.

- [ ] **Step 3: P8 design review**

Inspect desktop and mobile screenshots of dataset list and admin row detail. Check:

- compact controls with Lucide icons and tooltips;
- no overlapping text or controls;
- no layout shift during row navigation;
- disabled boundary states;
- clear save/error/dirty behavior;
- no new decorative or card-heavy UI.

- [ ] **Step 4: P9 persona testing**

Repeat the complete superadmin, admin, annotator, and same-tab account-switch journeys on dev. Use real browser actions and API-backed assertions. Report usability friction and timing separately from functional failures.

- [ ] **Step 5: Fix and rerun**

Route each blocking finding back to its owning lane, increment that lane generation, and rerun the affected gate plus all downstream gates. Continue until P6-P9 all return terminal pass receipts.

## Task 8: Dev Then Production Rollout

**Owner lane:** `integration-evidence`

**Prerequisite:** P6, P7, P8, and P9 all pass.

- [ ] **Step 1: Apply dev migration safely**

Run the migration gate against dev, record before/after row counts, verify RLS and grants, and verify concurrent indexes. Stop on any invariant mismatch.

- [ ] **Step 2: Push dev and verify deployment**

Push the reviewed integration commit to the GitHub dev branch. Confirm the existing Vercel dev project deployed that exact commit. Run the full dev smoke, persona, persistence, and performance gates again.

- [ ] **Step 3: Promote the same commit to production**

Merge the exact verified commit to `main`; do not rebuild a different source state. Apply the production migration gate, confirm the existing production Vercel project deployed the `main` commit, and run non-destructive production smoke and performance probes.

- [ ] **Step 4: Verify production data safety**

Compare aggregate counts and sampled immutable annotation result hashes before and after deployment. Use newly created isolated records for mutation verification, then clean up only those records.

- [ ] **Step 5: Record final receipt**

The terminal receipt must include:

- dev and main Git SHAs;
- dev and production Vercel deployment IDs/URLs;
- migration catalog and row-count evidence;
- P6-P9 receipt paths;
- cold and warm endpoint timings;
- confirmation that annotation persistence checks passed.

## Herdr Delivery Contract

```yaml
contract_id: api-fast-path-admin-navigation-20260731
generation: 1
base_sha: ed5ac2e9b2a7fb03a271e42970fe2c746ad84ac3
approved_spec:
  path: docs/superpowers/specs/2026-07-31-api-fast-path-admin-row-navigation-design.md
  sha256: 6da5c12ca5c64a02ea8cae1c7aac4e7d677d050b470cdb9caff26f596301de1b
gate: standard
controller:
  pane: P1
  rule: controller-only
  forbidden:
    - product implementation
    - test implementation
    - integration
    - code review
    - commit
    - push
    - deploy
layout:
  rule: do not create or move a worker pane below P1
lanes:
  - lane_id: security-auth-fast-path
    preferred_pane: P2
    prerequisites: []
    owned_paths:
      - migrations/0022_annotation_queue_adjudication.sql
      - migrations/0023_annotation_adjudication_security.sql
      - scripts/apply-annotation-queue-migration.ts
      - scripts/diagnose-runtime-topology.ts
      - src/lib/supabase/server.ts
      - src/lib/auth-middleware.ts
      - src/lib/auth.ts
      - src/lib/request-timing.ts
      - tests/datasets/annotation-adjudication-security.test.ts
      - tests/datasets/auth-fast-path.test.ts
      - tests/datasets/request-timing.test.ts
      - vercel.json
    acceptance:
      - adjudication RLS and grants verified
      - concurrent indexes run outside transaction
      - verified JWT claims only
      - authoritative database role
      - Server-Timing on protected APIs
      - focused tests, typecheck, and build pass
    terminal_receipt_command: "git show --stat --oneline HEAD && git status --short"
  - lane_id: api-read-queries
    preferred_pane: P3
    prerequisites:
      - security-auth-fast-path public auth wrapper contract
    owned_paths:
      - src/app/api/datasets/route.ts
      - src/app/api/datasets/[id]/rows/route.ts
      - src/app/api/datasets/[id]/rows/[rowId]/route.ts
      - src/app/api/admin/members/route.ts
      - src/app/api/rubrics/route.ts
      - src/app/api/admin/dashboard/route.ts
      - src/lib/datasets/admin-row-query.ts
      - tests/datasets/dataset-query-contracts.test.ts
      - tests/datasets/admin-row-navigation.test.ts
    acceptance:
      - bounded dataset and dashboard queries
      - filters before pagination
      - filtered totals
      - row detail includes adjudication and neighbors
      - no duplicate internal API fetch
      - query evidence recorded before adding indexes
      - focused tests, typecheck, and build pass
    terminal_receipt_command: "git show --stat --oneline HEAD && git status --short"
  - lane_id: client-admin-navigation
    preferred_pane: P4
    prerequisites:
      - api-read-queries response contracts
    owned_paths:
      - src/hooks/use-fast-resource.ts
      - src/lib/auth-client.ts
      - src/components/app-shell.tsx
      - src/components/app-header.tsx
      - src/components/fast-resource-session.tsx
      - src/app/admin/dashboard/dashboard-data-region.tsx
      - src/app/admin/datasets/page.tsx
      - src/app/admin/datasets/[id]/rows/[rowId]/page.tsx
      - src/components/admin/adjudication-panel.tsx
      - src/lib/datasets/admin-row-navigation.ts
      - tests/datasets/fast-resource-session.test.ts
      - tests/datasets/dataset-page-state.test.ts
      - tests/datasets/admin-row-navigation-ui.test.ts
    acceptance:
      - user-scoped cache and auth-transition clearing
      - stable page label and rows
      - one dashboard request
      - Previous, Next, Save, and Save & next
      - dirty guard and failed-save preservation
      - next-row prefetch and keyboard navigation
      - focused tests, typecheck, and build pass
    terminal_receipt_command: "git show --stat --oneline HEAD && git status --short"
  - lane_id: integration-evidence
    preferred_pane: P5
    prerequisites:
      - security-auth-fast-path
      - api-read-queries
      - client-admin-navigation
    owned_paths:
      - tests/datasets/run.ts
      - tests/e2e/annotation-queue.spec.ts
      - tests/e2e/full-flow.spec.ts
      - tests/e2e/navigation-performance.spec.ts
      - tests/e2e/performance-smoke.spec.ts
      - scripts/benchmark-navigation-performance.ts
      - scripts/verify-annotation-persistence.ts
      - test-results/api-fast-path-*
      - integration branch and deployment refs
    acceptance:
      - all lane commits integrated
      - full focused suite, typecheck, and build pass
      - cold and warm timings separated
      - all three personas and same-tab switch pass
      - persistence verifier passes
      - exact commit deployed dev then production
    terminal_receipt_command: "git log -5 --oneline && git status --short"
review_lanes:
  - lane_id: code-review
    preferred_pane: P6
    scope: security, correctness, data integrity, performance regressions, missing tests
  - lane_id: quality-control
    preferred_pane: P7
    scope: build, tests, migration, API benchmark, persistence evidence
  - lane_id: design-review
    preferred_pane: P8
    scope: admin row UX, responsive screenshots, visual regressions
  - lane_id: persona-testing
    preferred_pane: P9
    scope: real superadmin, admin, annotator, and same-tab account-switch flows
failure_routing:
  security_or_data_loss: security-auth-fast-path
  api_contract_or_query: api-read-queries
  cache_or_admin_ux: client-admin-navigation
  integration_or_evidence: integration-evidence
  rule: increment the failed lane generation and rerun all downstream gates
delivery:
  sequence:
    - dev migration
    - dev push and Vercel verification
    - dev full gates
    - main promotion of exact verified commit
    - production migration
    - production Vercel verification
    - non-destructive production gates
```

## Final Verification Commands

Run from the integrated worktree:

```bash
pnpm run test:datasets
pnpm run typecheck
pnpm run build
pnpm exec playwright test tests/e2e/full-flow.spec.ts --project=chromium
pnpm exec playwright test tests/e2e/annotation-queue.spec.ts --project=chromium
pnpm exec playwright test tests/e2e/navigation-performance.spec.ts --project=chromium
pnpm exec playwright test tests/e2e/performance-smoke.spec.ts --project=chromium
pnpm exec tsx scripts/verify-annotation-persistence.ts --target=dev
pnpm run benchmark:navigation -- --target=dev --runs=10
git diff --check
git status --short
```

Expected: every command passes, the worktree is clean, direct warmed hot-read p95 is reported honestly against the 150 ms target, and annotation persistence evidence has no mismatches.
