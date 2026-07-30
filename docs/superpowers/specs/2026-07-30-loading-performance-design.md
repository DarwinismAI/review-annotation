# Loading Performance Design

## Goal

Make navigation and empty-state loading feel fast on production without reducing annotation quality or risking saved annotation data.

The target experience is:

- Clicking a sidebar tab gives visible feedback in under 150 ms.
- The route shell and main controls render without waiting for list API data.
- Empty or small list APIs return in under 500 ms in normal production conditions.
- Previously loaded list data remains visible while refreshing.
- Annotation submit, draft, skip, assignment, import, and export flows keep strict no-stale-write behavior.

## Problem Summary

The current app makes many list pages feel slow even when there is little or no data because route changes and data fetches are coupled too tightly:

- Many pages mount with a blank or full skeleton state and fetch with `cache: "no-store"`.
- The shared `useJsonResource` hook only exposes `loading`, so callers often hide content while refreshes happen.
- Some list APIs compute `count(*)`, grouped summaries, joins, or full JSON projections before returning list data.
- The app shell performs server-side session gating for each protected workspace route, so auth/session latency can affect every tab.
- Annotator task-group APIs can pull all user assignments to build summaries in memory.

The Datasets hotfix already started the API-list contract: list endpoints should not fetch heavy JSON fields or global aggregates unless explicitly requested.

## Approach

Use a staged combined rollout with three layers.

### 1. Fast Client Shell

Introduce a shared `useFastResource` hook for read-only list resources. It will:

- Cache successful GET payloads in memory by URL for a short TTL.
- Return stale cached data immediately while a background refresh runs.
- Preserve the previous payload during pagination/search/filter refreshes.
- Abort superseded requests.
- Expose `status`, `isInitialLoading`, `isRefreshing`, `error`, `reload`, and `mutate`.

This hook is only for read-only GET pages. It must not cache mutation responses. Mutation code must explicitly call invalidation helpers for affected URL prefixes.

Initial pages to convert:

- `src/app/admin/dashboard/page.tsx`
- `src/app/admin/datasets/page.tsx`
- `src/app/admin/members/page.tsx`
- `src/app/admin/rubrics/page.tsx`
- `src/app/annotator/tasks/page.tsx`
- `src/components/admin/dataset-import-jobs-panel.tsx`

Pages should render a stable shell immediately. Skeletons are allowed for unknown first load, but once data exists, refresh should show subtle inline state rather than blanking the table.

### 2. Lightweight API Contracts

Each list endpoint must define whether it is a list, detail, summary, or mutation route.

List routes should:

- Select only scalar/list fields required by the visible UI.
- Avoid `db.select().from(table)` when the table contains JSON/detail columns.
- Avoid global `count(*)` unless the UI genuinely needs exact pagination.
- Gate expensive summaries behind explicit query params or separate summary endpoints.
- Keep pagination bounded.

Initial API targets:

- `src/app/api/datasets/route.ts`: keep the hotfix contract and add tests for default no-summary/no-count behavior.
- `src/app/api/annotator/task-groups/route.ts`: return grouped task summaries without fetching every assignment when possible.
- `src/app/api/annotator/tasks/route.ts`: limit list payload to fields used by the task list; detail route owns row JSON.
- `src/app/api/datasets/[id]/rows/route.ts`: keep row list projection bounded and make exact total optional if it becomes a bottleneck.
- `src/app/api/rubrics/route.ts` and `src/app/api/admin/members/route.ts`: confirm they return only fields used by list pages.

Mutation and data-integrity routes are out of scope for caching shortcuts. These remain strict:

- annotation draft/save/submit/skip
- assignment
- import append/create
- export/download
- role changes

### 3. Performance Evidence Gate

Add Playwright performance smoke that records:

- click-to-active-nav time
- click-to-first-heading time
- time until first table/list shell is visible
- network status, response duration, and approximate payload size for key APIs
- console errors

Role flows:

- Superadmin/admin: dashboard, datasets, members, rubric, dataset detail if data exists.
- Annotator: task groups, first task detail if assigned, safe navigation back to task list.

Performance budgets:

- Sidebar active feedback: under 150 ms.
- Route heading visible: under 250 ms after click on warmed app.
- Empty/small list API: under 500 ms.
- No raw JSON parse errors in UI.
- No full-page blank after a page has cached data.

Dev persona testing must run only on the correct dev Vercel project. If GitHub/Vercel metadata resolves to the disallowed stale `cxzharry` project, the test must stop with a deployment blocker.

## Data Safety

The caching layer must be read-through only:

- Cache keys are URL strings for GET resources.
- Mutations never read from cache as proof of success.
- Successful mutations invalidate affected prefixes.
- Annotation draft/submit/skip pages can use shell improvements, but save state and next-task selection must always use fresh server responses.

This means performance work can improve perceived load time without hiding failed saves or returning stale task completion state.

## Acceptance Criteria

- Admin and annotator tab switches show active nav and route shell quickly.
- List pages no longer blank previously loaded data during refresh.
- Datasets list keeps the hotfix behavior: no raw JSON parse error and no heavy default list query.
- Annotator task list does not fetch row JSON that only task detail needs.
- Performance smoke produces evidence files for local and dev, or a precise dev deployment blocker.
- Existing checks still pass: typecheck, dataset tests, full-flow e2e, navigation performance e2e, build.
