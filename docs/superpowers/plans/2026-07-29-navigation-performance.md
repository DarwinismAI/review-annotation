# Navigation Performance Implementation Plan

> **For Herdr delivery:** REQUIRED SUB-SKILL: Use
> `herdr-orchestrator` only after this plan is approved.

**Goal:** Make primary admin and annotator navigation feel immediate while keeping scoped list/detail APIs under 500ms on the approved benchmark seed and preserving annotation data safety.

**Architecture:** Add a measured performance harness first, then improve the shared navigation interaction and page-level loading behavior. Backend changes are evidence-led and limited to scoped read endpoints; mutation paths for import, append, assignment, draft, submit, and role changes stay uncached and fully validated.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Drizzle ORM, local SQLite through `LOCAL_DB_PATH`, Playwright, Herdr, meta-harness.

---

## Approved Inputs

- Spec: `docs/superpowers/specs/2026-07-29-navigation-performance-design.md`
- Spec SHA-256: `de84316d0c7c0e6fe6e010cda255315f28a6cb27a42946522b5acbcb2e445def`
- Repository root: `/Users/haido/expert-review`
- Base SHA: `790b8bd969074d8dc4f9e80a67850c03a69086ec`
- Implementation backend after approval: `herdr-orchestrator`
- Quality loop after approval: `meta-harness`, intent `DELIVER`, target `8/10`, max iterations `3`

## File Structure

- Create `src/components/app-navigation.tsx`
  - Shared client navigation items, optimistic active state, and route prefetch behavior.
  - Used by both sidebar and mobile nav.
- Modify `src/components/app-sidebar.tsx`
  - Render desktop nav through the shared navigation component.
- Modify `src/components/app-mobile-nav.tsx`
  - Render mobile nav through the shared navigation component.
- Create `src/hooks/use-json-resource.ts`
  - Small client fetch hook with abort cleanup, local loading/error state, and no mutation caching.
- Modify `src/app/admin/dashboard/page.tsx`
  - Use the fetch hook and keep shell/page heading stable.
- Modify `src/app/admin/datasets/page.tsx`
  - Use the fetch hook and keep skeleton local to the table body.
- Modify `src/app/admin/members/page.tsx`
  - Use abort-safe fetching for the initial member list.
- Modify `src/app/annotator/tasks/page.tsx`
  - Use the fetch hook for task list loading.
- Create `scripts/seed-navigation-performance.ts`
  - Deterministic local benchmark seed: 10 datasets, 1,000 rows per dataset, 10 annotators.
- Create `scripts/benchmark-navigation-performance.ts`
  - Measures the scoped API endpoints through a running local app using real local auth cookies.
- Modify `package.json`
  - Add `seed:perf` and `benchmark:navigation` scripts.
- Modify `tests/e2e/full-flow.spec.ts`
  - Keep existing persistence and role coverage intact.
- Create `tests/e2e/navigation-performance.spec.ts`
  - Measures immediate nav active state on desktop and mobile.
- Optionally modify scoped API routes only if the first benchmark fails:
  - `src/app/api/datasets/route.ts`
  - `src/app/api/admin/members/route.ts`
  - `src/app/api/annotator/tasks/route.ts`
  - `src/app/api/datasets/[id]/route.ts`
  - `src/app/api/datasets/[id]/rows/route.ts`

## Meta-Harness Execution Contract

Gate: PROCEED - multi-file frontend plus backend performance work with measurable rubric.

Intent: DELIVER - runnable code, browser behavior, and API benchmark artifacts.

Mode: Auto recommended - Herdr standard gate with parallel implementation lanes, because frontend navigation, benchmark harness, and backend read endpoint review have separable ownership but must converge through one integration owner.

Rubric:

```json
{
  "locked": true,
  "target": 8,
  "target_min": 6,
  "max_iter": 3,
  "criteria": [
    {
      "name": "responsiveness",
      "weight": 0.3,
      "pass": "Desktop and mobile primary nav active state changes within 100ms after a normal click, and shell/header remain visible during route transition."
    },
    {
      "name": "api_latency",
      "weight": 0.25,
      "pass": "Scoped list/detail APIs complete in 500ms or less after warm-up on the approved local benchmark seed."
    },
    {
      "name": "data_safety",
      "weight": 0.3,
      "pass": "Dataset helper tests and full Playwright annotation draft/submit/reload flows pass; mutation paths are not cached unsafely."
    },
    {
      "name": "craft",
      "weight": 0.15,
      "pass": "Motion is restrained, reduced motion is respected, loading is content-local, and no banned en dash or em dash appears in scoped UI files."
    }
  ]
}
```

Iteration routing:

- Iteration 1: add benchmark harness and shared navigation responsiveness. Evaluate API baseline and browser nav timing.
- Iteration 2: optimize any scoped API that fails 500ms or any page that blanks shell/content incorrectly.
- Iteration 3: fix remaining rubric failures only. Do not broaden scope.

Stop on:

- SUCCESS: all rubric criteria meet target.
- ENV: same local server, database, or Vercel environment failure repeats 3 times.
- REGRESSION: annotation persistence or mutation data safety fails.
- EXHAUSTED: 3 iterations complete without reaching target.

## Parallelization Strategy

Implementation parallelism: Parallel lanes.

Reason: benchmark tooling, shared nav/loading UI, and backend read endpoint review can start independently; P5 integrates and reruns the complete acceptance suite.

Can parallelize: yes.

Implementation lanes:

- Lane `benchmark`
  - Files: `scripts/seed-navigation-performance.ts`, `scripts/benchmark-navigation-performance.ts`, `package.json`
  - Responsibility: deterministic local seed and API latency measurement.
- Lane `frontend`
  - Files: `src/components/app-navigation.tsx`, `src/components/app-sidebar.tsx`, `src/components/app-mobile-nav.tsx`, `src/hooks/use-json-resource.ts`, scoped list pages.
  - Responsibility: immediate active feedback, prefetch, abort-safe local loading.
- Lane `backend`
  - Files: scoped API routes only if benchmark evidence fails.
  - Responsibility: bounded read endpoints without changing mutation semantics.
- Lane `verification`
  - Files: `tests/e2e/navigation-performance.spec.ts`, targeted updates to `tests/e2e/full-flow.spec.ts`.
  - Responsibility: browser timing assertion and data-safety regression coverage.

Sequential dependencies:

- `benchmark` must define the API threshold command before `backend` finalizes any evidence-led optimization.
- `frontend` can implement shared nav before benchmark completes.
- `verification` depends on `frontend` for the nav timing test target and on `benchmark` for the API command.
- P5 integration waits for current lane receipts before publishing the candidate artifact.

Verification:

- Per-lane checks:
  - `benchmark`: `pnpm run seed:perf && pnpm run benchmark:navigation`
  - `frontend`: `pnpm run typecheck` plus targeted Playwright nav smoke
  - `backend`: `pnpm run benchmark:navigation`
  - `verification`: `pnpm run test:e2e`
- Final checks:
  - `pnpm run typecheck`
  - `pnpm run test:datasets`
  - `pnpm run seed:perf`
  - `pnpm run benchmark:navigation`
  - `pnpm run test:e2e`
  - `pnpm run build`
  - `git diff --check`

Recommended Phase 3 Agent Split Gate input: Spawn.

Reason: the accepted lanes have disjoint first-wave ownership and produce evidence that P5 can integrate.

## Herdr Delivery Contract

```yaml
herdr_delivery:
  backend: herdr
  approved_inputs:
    spec_path: docs/superpowers/specs/2026-07-29-navigation-performance-design.md
    spec_sha256: de84316d0c7c0e6fe6e010cda255315f28a6cb27a42946522b5acbcb2e445def
    repo_root: /Users/haido/expert-review
    base_sha: 790b8bd969074d8dc4f9e80a67850c03a69086ec
    plan_acceptance: user must approve this plan before execution
  lanes:
    - lane_id: benchmark
      role: implementation
      eligible_slots: [P2, P3, P4]
      owned_paths:
        - scripts/seed-navigation-performance.ts
        - scripts/benchmark-navigation-performance.ts
        - package.json
      prerequisites:
        - local SQLite is available through LOCAL_DB_PATH
        - local app can run with /api/dev/login
      dependency_wave: 1
      acceptance:
        - deterministic seed creates 10 datasets, 1000 rows per dataset, and 10 active annotators
        - benchmark logs latency for all scoped endpoints and exits nonzero above 500ms
      terminal_checks:
        - pnpm run seed:perf
        - pnpm run benchmark:navigation
    - lane_id: frontend
      role: implementation
      eligible_slots: [P2, P3, P4]
      owned_paths:
        - src/components/app-navigation.tsx
        - src/components/app-sidebar.tsx
        - src/components/app-mobile-nav.tsx
        - src/hooks/use-json-resource.ts
        - src/app/admin/dashboard/page.tsx
        - src/app/admin/datasets/page.tsx
        - src/app/admin/members/page.tsx
        - src/app/annotator/tasks/page.tsx
      prerequisites:
        - existing app shell remains the auth and RBAC boundary
      dependency_wave: 1
      acceptance:
        - nav active state updates optimistically on normal clicks
        - route prefetch runs for primary nav links without affecting mutation paths
        - page loading is content-local and abort-safe
        - motion uses only transform, opacity, background-color, and color
      terminal_checks:
        - pnpm run typecheck
        - rg -n "[\\u2013\\u2014]" src/components/app-navigation.tsx src/components/app-sidebar.tsx src/components/app-mobile-nav.tsx src/app/admin/dashboard/page.tsx src/app/admin/datasets/page.tsx src/app/admin/members/page.tsx src/app/annotator/tasks/page.tsx
    - lane_id: verification
      role: implementation
      eligible_slots: [P2, P3, P4]
      owned_paths:
        - tests/e2e/navigation-performance.spec.ts
        - tests/e2e/full-flow.spec.ts
      prerequisites:
        - frontend lane defines stable nav labels and routes
      dependency_wave: 2
      acceptance:
        - desktop and mobile nav timing tests assert active state below 100ms
        - existing full-flow tests still cover draft, submit, reload, assignment, and append validation
      terminal_checks:
        - pnpm run test:e2e
    - lane_id: backend
      role: implementation
      eligible_slots: [P2, P3, P4]
      owned_paths:
        - src/app/api/datasets/route.ts
        - src/app/api/admin/members/route.ts
        - src/app/api/annotator/tasks/route.ts
        - src/app/api/datasets/[id]/route.ts
        - src/app/api/datasets/[id]/rows/route.ts
      prerequisites:
        - benchmark lane produces failing latency evidence for a scoped endpoint
      dependency_wave: 2
      acceptance:
        - only endpoints above 500ms are changed
        - response semantics required by current UI and tests are preserved
        - mutation routes remain uncached and unchanged
      terminal_checks:
        - pnpm run benchmark:navigation
        - pnpm run test:datasets
  reviews:
    P5:
      applicable: true
      role: integration-owner
      responsibilities:
        - merge accepted lane outputs
        - run final local runtime smoke
        - own final commit
    P6:
      applicable: true
      role: integration-reviewer
      reason: backend and data-safety scope
    P7:
      applicable: true
      role: qc
      reason: functional, regression, data-integrity, and RBAC checks apply
    P8:
      applicable: true
      role: designer
      reason: UI motion and loading experience scope
    P9:
      applicable: false
      reason: no new persona workflow beyond existing admin and annotator journeys
  deployment:
    topology: no-deployment-target
    verification: isolated-local-runtime
    note: push or Vercel deployment requires a later explicit approval
  blocking_severity:
    critical:
      - data loss
      - failed draft or submit persistence
      - auth or RBAC regression
      - build failure
      - scoped API benchmark above 500ms after iteration 3
    high:
      - nav active state above 100ms
      - full-page blank loading after shell route
      - unsafe mutation caching
  required_evidence:
    - benchmark output with endpoint durations
    - Playwright nav timing evidence
    - full e2e result
    - typecheck result
    - build result
    - Herdr P6, P7, and P8 receipts
```

## Task 1: Add Deterministic Performance Seed

**Files:**

- Create: `scripts/seed-navigation-performance.ts`
- Modify: `package.json`

- [ ] **Step 1: Add the script entry to `package.json`**

Add this script:

```json
"seed:perf": "LOCAL_DB_PATH=file:.tmp/navigation-performance.db tsx scripts/seed-navigation-performance.ts"
```

- [ ] **Step 2: Create `scripts/seed-navigation-performance.ts`**

Create a deterministic seed script with this structure:

```ts
import { createClient } from "@libsql/client";
import { createId } from "@paralleldrive/cuid2";

const DB_PATH = process.env.LOCAL_DB_PATH ?? "file:.tmp/navigation-performance.db";
const DATASET_COUNT = 10;
const ROWS_PER_DATASET = 1000;
const ANNOTATOR_COUNT = 10;
const now = new Date("2026-07-29T00:00:00.000Z").toISOString();

const client = createClient({ url: DB_PATH });

async function exec(sql: string, args: unknown[] = []) {
  await client.execute({ sql, args });
}

function json(value: unknown) {
  return JSON.stringify(value);
}

async function clearPerfRows() {
  await exec("DELETE FROM annotation_results WHERE row_id LIKE 'perf-row-%'");
  await exec("DELETE FROM annotation_assignments WHERE id LIKE 'perf-assignment-%'");
  await exec("DELETE FROM annotation_assignment_runs WHERE id LIKE 'perf-run-%'");
  await exec("DELETE FROM annotation_metrics WHERE id LIKE 'perf-metric-%'");
  await exec("DELETE FROM dataset_rows WHERE id LIKE 'perf-row-%'");
  await exec("DELETE FROM dataset_imports WHERE id LIKE 'perf-import-%'");
  await exec("DELETE FROM datasets WHERE id LIKE 'perf-dataset-%'");
  await exec("DELETE FROM expert_profiles WHERE user_id LIKE 'perf-annotator-%'");
  await exec("DELETE FROM profiles WHERE id LIKE 'perf-annotator-%'");
}

async function seedUsers() {
  await exec(
    "INSERT OR REPLACE INTO profiles (id, email, role, name, created_at, updated_at) VALUES (?, ?, 'admin', 'Performance Admin', ?, ?)",
    ["perf-admin", "admin@local.dev", now, now],
  );
  await exec(
    "INSERT OR REPLACE INTO profiles (id, email, role, name, created_at, updated_at) VALUES (?, ?, 'superadmin', 'Performance Superadmin', ?, ?)",
    ["perf-superadmin", "superadmin@local.dev", now, now],
  );
  for (let index = 1; index <= ANNOTATOR_COUNT; index += 1) {
    const id = `perf-annotator-${index}`;
    await exec(
      "INSERT OR REPLACE INTO profiles (id, email, role, name, created_at, updated_at) VALUES (?, ?, 'annotator', ?, ?, ?)",
      [id, `perf-annotator-${index}@local.dev`, `Perf Annotator ${index}`, now, now],
    );
    await exec(
      "INSERT OR REPLACE INTO expert_profiles (id, user_id, domain, status, invited_at, activated_at, created_at, updated_at) VALUES (?, ?, 'safety_compliance', 'active', ?, ?, ?, ?)",
      [`perf-expert-profile-${index}`, id, Date.now(), Date.now(), Date.now(), Date.now()],
    );
  }
}

async function seedDatasets() {
  for (let datasetIndex = 1; datasetIndex <= DATASET_COUNT; datasetIndex += 1) {
    const datasetId = `perf-dataset-${datasetIndex}`;
    const importId = `perf-import-${datasetIndex}`;
    await exec(
      "INSERT INTO datasets (id, name, domain, status, schema_fingerprint, display_config, required_append_fields, created_by, created_at, updated_at) VALUES (?, ?, 'safety_compliance', 'ready', ?, ?, ?, 'perf-admin', ?, ?)",
      [
        datasetId,
        `Performance Dataset ${datasetIndex}`,
        json([
          { path: "input", type: "string", sample: "sample input" },
          { path: "output", type: "string", sample: "sample output" },
          { path: "label.policy", type: "string", sample: "block" },
        ]),
        json({ listFields: ["input", "label.policy"], detailFields: ["input", "output", "label.policy"] }),
        json(["input", "output", "label.policy"]),
        now,
        now,
      ],
    );
    await exec(
      "INSERT INTO dataset_imports (id, dataset_id, source_filename, status, row_count, created_by, created_at) VALUES (?, ?, ?, 'completed', ?, 'perf-admin', ?)",
      [importId, datasetId, `performance-${datasetIndex}.jsonl`, ROWS_PER_DATASET, now],
    );
    await exec(
      "INSERT INTO annotation_metrics (id, dataset_id, key, label, description, scale_json, required, sort_order, created_at, updated_at) VALUES (?, ?, 'policy_violation', 'Vi phạm chính sách', 'Pass or failed policy compliance', ?, 1, 0, ?, ?)",
      [`perf-metric-${datasetIndex}`, datasetId, json({ values: ["Failed", "Pass"] }), now, now],
    );
    const runId = `perf-run-${datasetIndex}`;
    await exec(
      "INSERT INTO annotation_assignment_runs (id, dataset_id, target_overlap, metric_ids, scope, created_by, created_at) VALUES (?, ?, 1, ?, 'all', 'perf-admin', ?)",
      [runId, datasetId, json([`perf-metric-${datasetIndex}`]), now],
    );
    for (let rowIndex = 1; rowIndex <= ROWS_PER_DATASET; rowIndex += 1) {
      const rowId = `perf-row-${datasetIndex}-${rowIndex}`;
      await exec(
        "INSERT INTO dataset_rows (id, dataset_id, import_id, internal_row_id, raw_json, source_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          rowId,
          datasetId,
          importId,
          rowIndex,
          json({
            id: `perf-${datasetIndex}-${rowIndex}`,
            input: `Safety compliance input ${datasetIndex}-${rowIndex}`,
            output: `Safety compliance output ${datasetIndex}-${rowIndex}`,
            label: { policy: rowIndex % 2 === 0 ? "allow" : "block" },
          }),
          `perf-${datasetIndex}-${rowIndex}`,
          now,
        ],
      );
      if (rowIndex <= 100) {
        const annotatorId = `perf-annotator-${((rowIndex - 1) % ANNOTATOR_COUNT) + 1}`;
        await exec(
          "INSERT INTO annotation_assignments (id, assignment_run_id, dataset_id, row_id, annotator_id, metric_ids, metric_key, target_overlap, status, assigned_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'assigned', ?, ?, ?)",
          [
            `perf-assignment-${datasetIndex}-${rowIndex}`,
            runId,
            datasetId,
            rowId,
            annotatorId,
            json([`perf-metric-${datasetIndex}`]),
            `perf-metric-${datasetIndex}`,
            now,
            now,
            now,
          ],
        );
      }
    }
  }
}

async function main() {
  await clearPerfRows();
  await seedUsers();
  await seedDatasets();
  console.log(`Seeded ${DATASET_COUNT} datasets, ${DATASET_COUNT * ROWS_PER_DATASET} rows, ${ANNOTATOR_COUNT} annotators into ${DB_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 3: Run seed command**

Run:

```bash
pnpm run seed:perf
```

Expected:

```text
Seeded 10 datasets, 10000 rows, 10 annotators into file:.tmp/navigation-performance.db
```

## Task 2: Add API Benchmark Command

**Files:**

- Create: `scripts/benchmark-navigation-performance.ts`
- Modify: `package.json`

- [ ] **Step 1: Add the benchmark script to `package.json`**

Add this script:

```json
"benchmark:navigation": "tsx scripts/benchmark-navigation-performance.ts"
```

- [ ] **Step 2: Create `scripts/benchmark-navigation-performance.ts`**

Create a script that logs in through local dev auth, measures scoped endpoints, and exits nonzero if any endpoint is above 500ms:

```ts
const BASE_URL = process.env.BENCHMARK_BASE_URL ?? "http://127.0.0.1:3002";
const PASSWORD = process.env.BENCHMARK_PASSWORD ?? "local-dev-password";
const THRESHOLD_MS = Number(process.env.BENCHMARK_THRESHOLD_MS ?? 500);

type Endpoint = { name: string; path: string; role: "admin" | "annotator" };

async function login(email: string) {
  const response = await fetch(`${BASE_URL}/api/dev/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`login failed for ${email}: ${response.status}`);
  const cookie = response.headers.get("set-cookie");
  if (!cookie) throw new Error(`missing dev auth cookie for ${email}`);
  return cookie.split(";")[0];
}

async function timeRequest(endpoint: Endpoint, cookie: string) {
  const start = performance.now();
  const response = await fetch(`${BASE_URL}${endpoint.path}`, { headers: { cookie } });
  const durationMs = Math.round(performance.now() - start);
  if (!response.ok) throw new Error(`${endpoint.name} failed with ${response.status}`);
  await response.arrayBuffer();
  return durationMs;
}

async function main() {
  const adminCookie = await login("admin@local.dev");
  const annotatorCookie = await login("annotator@local.dev");
  const endpoints: Endpoint[] = [
    { name: "datasets", path: "/api/datasets", role: "admin" },
    { name: "members", path: "/api/admin/members", role: "admin" },
    { name: "dataset-detail", path: "/api/datasets/perf-dataset-1", role: "admin" },
    { name: "dataset-rows", path: "/api/datasets/perf-dataset-1/rows?pageSize=200", role: "admin" },
    { name: "annotator-tasks", path: "/api/annotator/tasks?pageSize=100", role: "annotator" },
  ];

  const failures: string[] = [];
  for (const endpoint of endpoints) {
    const cookie = endpoint.role === "admin" ? adminCookie : annotatorCookie;
    await timeRequest(endpoint, cookie);
    const samples = [];
    for (let index = 0; index < 5; index += 1) samples.push(await timeRequest(endpoint, cookie));
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length / 2)];
    const max = samples[samples.length - 1];
    console.log(`${endpoint.name} p50=${p50}ms max=${max}ms threshold=${THRESHOLD_MS}ms`);
    if (max > THRESHOLD_MS) failures.push(`${endpoint.name} max ${max}ms`);
  }

  if (failures.length > 0) {
    console.error(`Benchmark failed: ${failures.join(", ")}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 3: Run benchmark against local server**

Start local server in a separate process:

```bash
LOCAL_DB_PATH=file:.tmp/navigation-performance.db ADMIN_PASSWORD=local-dev-password EXPERT_PASSWORD=local-dev-password SUPERADMIN_PASSWORD=local-dev-password pnpm dev --port 3002
```

Then run:

```bash
BENCHMARK_BASE_URL=http://127.0.0.1:3002 pnpm run benchmark:navigation
```

Expected: each endpoint prints `max=<number>ms threshold=500ms`; command exits `0` only when every endpoint is under threshold.

## Task 3: Extract Shared Navigation Behavior

**Files:**

- Create: `src/components/app-navigation.tsx`
- Modify: `src/components/app-sidebar.tsx`
- Modify: `src/components/app-mobile-nav.tsx`
- Test: `tests/e2e/navigation-performance.spec.ts`

- [ ] **Step 1: Write the failing navigation timing test**

Create `tests/e2e/navigation-performance.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD ?? "local-dev-password";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL(/\/admin/);
}

async function expectImmediateActive(page: Page, label: RegExp | string) {
  const link = page.getByRole("link", { name: label });
  const start = performance.now();
  await link.click({ noWaitAfter: true });
  await expect(link).toHaveAttribute("aria-current", "page");
  const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(100);
}

test("desktop primary nav marks clicked tab active immediately", async ({ page }) => {
  await login(page, "admin@local.dev");
  await page.goto("/admin/dashboard");
  await expectImmediateActive(page, /^Datasets$/);
  await page.waitForURL(/\/admin\/datasets/);
  await expectImmediateActive(page, /^Thành viên$/);
});

test("mobile primary nav marks clicked tab active immediately", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "admin@local.dev");
  await page.goto("/admin/dashboard");
  await expectImmediateActive(page, /^Datasets$/);
  await page.waitForURL(/\/admin\/datasets/);
  await expectImmediateActive(page, /^Tổng quan$/);
});
```

- [ ] **Step 2: Run the new test and verify current behavior**

Run:

```bash
pnpm exec playwright test tests/e2e/navigation-performance.spec.ts
```

Expected before implementation: test may fail if nav active timing is inconsistent or duplicated behavior is not shared.

- [ ] **Step 3: Create `src/components/app-navigation.tsx`**

Implement shared nav items, optimistic active state, and prefetch:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ClipboardList, FileText, LayoutDashboard, TableProperties, UserCircle, Users, type LucideIcon } from "lucide-react";

type NavVariant = "admin" | "annotator";
type NavMode = "sidebar" | "mobile";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const ADMIN_NAV: NavItem[] = [
  { href: "/admin/dashboard", label: "Tổng quan", icon: LayoutDashboard },
  { href: "/admin/datasets", label: "Datasets", icon: TableProperties },
  { href: "/admin/members", label: "Thành viên", icon: Users },
  { href: "/admin/rubrics", label: "Rubric", icon: ClipboardList },
];

const ANNOTATOR_NAV: NavItem[] = [
  { href: "/annotator/tasks", label: "Task của tôi", icon: FileText },
  { href: "/annotator/profile", label: "Hồ sơ", icon: UserCircle },
];

export function getDefaultHref(variant: NavVariant) {
  return variant === "admin" ? "/admin/dashboard" : "/annotator/tasks";
}

export function AppNavigationItems({ variant, mode }: { variant: NavVariant; mode: NavMode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [optimisticPath, setOptimisticPath] = useState<string | null>(null);
  const items = useMemo(() => (variant === "admin" ? ADMIN_NAV : ANNOTATOR_NAV), [variant]);
  const activePath = optimisticPath ?? pathname;

  useEffect(() => {
    setOptimisticPath(null);
  }, [pathname]);

  useEffect(() => {
    for (const item of items) router.prefetch(item.href);
  }, [items, router]);

  return items.map(({ href, label, icon: Icon }) => {
    const active = activePath === href || activePath.startsWith(`${href}/`);
    const commonClass =
      "font-medium transition-[background-color,color,opacity,transform] duration-100 ease-out motion-reduce:transition-none";
    const modeClass =
      mode === "sidebar"
        ? "flex h-10 items-center gap-3 rounded-md px-3 text-sm"
        : "flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1 text-xs";
    const activeClass =
      mode === "sidebar"
        ? "translate-x-0.5 bg-blue-50 text-blue-700"
        : "-translate-y-0.5 bg-blue-50 text-blue-700";
    const inactiveClass = mode === "sidebar" ? "text-slate-600 hover:bg-slate-100 hover:text-slate-900" : "text-slate-500 hover:text-slate-900";

    return (
      <Link
        key={href}
        href={href}
        onPointerEnter={() => router.prefetch(href)}
        onFocus={() => router.prefetch(href)}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          setOptimisticPath(href);
        }}
        aria-current={active ? "page" : undefined}
        className={`${modeClass} ${commonClass} ${active ? activeClass : inactiveClass}`}
      >
        <Icon className={`${mode === "sidebar" ? "h-4 w-4" : "h-5 w-5"} shrink-0 ${active ? "text-blue-700" : ""}`} />
        <span className={mode === "mobile" ? "max-w-full truncate" : ""}>{label}</span>
      </Link>
    );
  });
}
```

- [ ] **Step 4: Replace duplicated sidebar nav rendering**

In `src/components/app-sidebar.tsx`, import `AppNavigationItems` and `getDefaultHref`, remove local nav arrays and local optimistic state, and render:

```tsx
<Link
  href={getDefaultHref(variant)}
  className="text-sm font-bold text-slate-900 tracking-tight"
>
  Review Annotation
</Link>
```

Inside `<nav>`:

```tsx
<AppNavigationItems variant={variant} mode="sidebar" />
```

- [ ] **Step 5: Replace duplicated mobile nav rendering**

In `src/components/app-mobile-nav.tsx`, import `AppNavigationItems`, remove local nav arrays and local optimistic state, and render:

```tsx
<AppNavigationItems variant={variant} mode="mobile" />
```

- [ ] **Step 6: Run checks**

Run:

```bash
pnpm run typecheck
pnpm exec playwright test tests/e2e/navigation-performance.spec.ts
```

Expected: typecheck passes and both nav timing tests pass.

## Task 4: Make List Page Fetching Abort-Safe and Content-Local

**Files:**

- Create: `src/hooks/use-json-resource.ts`
- Modify: `src/app/admin/dashboard/page.tsx`
- Modify: `src/app/admin/datasets/page.tsx`
- Modify: `src/app/admin/members/page.tsx`
- Modify: `src/app/annotator/tasks/page.tsx`

- [ ] **Step 1: Create `src/hooks/use-json-resource.ts`**

```ts
"use client";

import { useEffect, useState } from "react";

interface JsonResourceState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useJsonResource<T>(url: string, initialData: T | null = null): JsonResourceState<T> {
  const [data, setData] = useState<T | null>(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Request failed: ${response.status}`);
        return response.json() as Promise<T>;
      })
      .then((payload) => setData(payload))
      .catch((fetchError) => {
        if ((fetchError as Error).name !== "AbortError") {
          setError(fetchError instanceof Error ? fetchError.message : "Không tải được dữ liệu");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [url]);

  return { data, loading, error };
}
```

- [ ] **Step 2: Update list pages to use the hook**

For each scoped list page:

- keep page heading outside conditional loading branches;
- keep table or content skeleton inside the page body;
- render an error callout without redirecting away;
- do not add caching to mutation routes.

Example pattern for `src/app/admin/datasets/page.tsx`:

```tsx
const { data, loading, error } = useJsonResource<{ datasets: DatasetListItem[] }>("/api/datasets", { datasets: [] });
const datasets = data?.datasets ?? [];
```

- [ ] **Step 3: Run checks**

Run:

```bash
pnpm run typecheck
pnpm exec playwright test tests/e2e/navigation-performance.spec.ts
```

Expected: typecheck passes, nav timing remains below 100ms, no full-page blank loading appears.

## Task 5: Apply Evidence-Led Backend Read Optimizations

**Files:**

- Modify only endpoints that fail `pnpm run benchmark:navigation`.

- [ ] **Step 1: Run baseline benchmark**

Run:

```bash
pnpm run seed:perf
LOCAL_DB_PATH=file:.tmp/navigation-performance.db ADMIN_PASSWORD=local-dev-password EXPERT_PASSWORD=local-dev-password SUPERADMIN_PASSWORD=local-dev-password pnpm dev --port 3002
BENCHMARK_BASE_URL=http://127.0.0.1:3002 pnpm run benchmark:navigation
```

Expected: benchmark either passes or lists exact failing endpoints.

- [ ] **Step 2: If `/api/datasets` fails, bound dataset list pagination**

Modify `src/app/api/datasets/route.ts` GET to parse optional `page` and `pageSize`, default `pageSize` to `50`, and return `total`, `page`, `pageSize`, and the current `datasets` array. Keep existing UI compatible by preserving `datasets`.

Use this shape:

```ts
const { searchParams } = new URL(req.url);
const page = Math.max(Number(searchParams.get("page") ?? 1), 1);
const pageSize = Math.min(Math.max(Number(searchParams.get("pageSize") ?? 50), 1), 200);
const [{ total }] = await db.select({ total: count() }).from(datasets);
const allDatasets = await db
  .select()
  .from(datasets)
  .orderBy(desc(datasets.createdAt))
  .limit(pageSize)
  .offset((page - 1) * pageSize);
```

- [ ] **Step 3: If `/api/admin/members` fails, move sort to SQL**

Modify `src/app/api/admin/members/route.ts`:

```ts
import { asc, eq } from "drizzle-orm";
```

Then add:

```ts
.orderBy(asc(profiles.email));
```

Remove the final JavaScript sort call that orders `members` after mapping.

- [ ] **Step 4: If `/api/datasets/:id/rows` fails, keep joins page-bounded**

Confirm assignment and result queries only use `rowIds` from the already paginated page. If a regression is found, preserve the existing `inArray(<column>, rowIds)` constraints and avoid querying all dataset rows.

- [ ] **Step 5: Rerun benchmark**

Run:

```bash
BENCHMARK_BASE_URL=http://127.0.0.1:3002 pnpm run benchmark:navigation
```

Expected: every scoped endpoint is below 500ms.

## Task 6: Preserve Data Safety Regression Coverage

**Files:**

- Modify: `tests/e2e/full-flow.spec.ts` only if needed

- [ ] **Step 1: Confirm current full flow still covers persistence**

Run:

```bash
pnpm run test:e2e
```

Expected: tests pass, including `annotator autosave, submit, and persisted metric values survive reload`.

- [ ] **Step 2: If fetch hook or page loading changes break tests, fix implementation rather than weakening tests**

Do not remove these assertions:

```ts
await expect(page.getByRole("button", { name: "Pass" })).toHaveAttribute("aria-pressed", "true");
await expect(page.getByLabel("Ghi chú")).toHaveValue("Looks compliant after reload");
```

- [ ] **Step 3: Run data-safety checks**

Run:

```bash
pnpm run test:datasets
pnpm run test:e2e
```

Expected: both pass.

## Task 7: Final Integration and Verification

**Files:**

- No new product files unless a previous task requires fixes

- [ ] **Step 1: Run full local verification**

Run:

```bash
pnpm run typecheck
pnpm run test:datasets
pnpm run seed:perf
BENCHMARK_BASE_URL=http://127.0.0.1:3002 pnpm run benchmark:navigation
pnpm run test:e2e
pnpm run build
git diff --check
```

Expected:

- typecheck passes;
- dataset helper tests pass;
- benchmark passes every scoped endpoint under 500ms;
- full e2e passes;
- build passes;
- diff check prints no output.

- [ ] **Step 2: Run Herdr review gates**

P5 publishes the local artifact tuple. P6 reviews backend/data-safety, P7 reviews functional regression, and P8 reviews UI motion/loading craft.

Expected:

- P6 PASS or findings routed to the owning lane.
- P7 PASS or findings routed to the owning lane.
- P8 PASS or findings routed to the owning lane.

- [ ] **Step 3: Commit final integrated implementation**

Only after all checks pass:

```bash
git status --short
git add src scripts tests package.json docs/superpowers/plans/2026-07-29-navigation-performance.md
git commit -m "perf: improve navigation responsiveness"
```

Expected: one coherent implementation commit. Do not push or deploy unless the user explicitly asks after local delivery is verified.

## Self-Review

- Spec coverage: every requirement in the design spec maps to a task.
- Placeholder scan: no incomplete marker, incomplete task, or unspecified acceptance remains.
- Type consistency: nav types use `NavVariant`, `NavMode`, and `LucideIcon`; benchmark endpoints use `Endpoint`; fetch hook returns `JsonResourceState<T>`.
- Scope check: plan is a single subsystem focused on navigation performance and scoped read API latency. It does not alter mutation semantics or deployment configuration.
