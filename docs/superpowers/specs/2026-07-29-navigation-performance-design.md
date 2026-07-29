# Navigation Performance Design

## Goal

Make navigation between the main admin and annotator screens feel immediate while preserving data correctness. A click on any primary navigation tab must show active feedback within 100ms, route shell/header must stay stable, and API-backed content may load locally inside the page without blanking the whole workspace.

## Scope

This applies to the primary navigation surfaces:

- Admin desktop sidebar and mobile nav: `Tổng quan`, `Datasets`, `Thành viên`, `Rubric`.
- Annotator desktop sidebar and mobile nav: `Task của tôi`, `Hồ sơ`.
- Main list/detail APIs used by those screens:
  - `/api/datasets`
  - `/api/admin/members`
  - `/api/annotator/tasks`
  - `/api/datasets/:id`
  - `/api/datasets/:id/rows`

The benchmark dataset size is 10 datasets, 1,000 rows per dataset, and 10 annotators.

## Non-Goals

- Do not remove validation from dataset import, append, assignment, draft, or submit flows.
- Do not reduce required response data to make latency look better.
- Do not cache annotation draft or submit mutations in a way that can lose writes or show stale saved state.
- Do not reintroduce the legacy batch dashboard APIs on the default `Tổng quan` screen.
- Do not redesign the product navigation structure beyond performance-focused behavior.

## Proposed Approach

Use a perceived-speed-first strategy with targeted backend fixes.

1. Navigation responds immediately.
   - Extract shared navigation behavior for desktop and mobile.
   - Use optimistic active state on normal clicks.
   - Prefetch main routes when navigation renders or when links are hovered/focused.
   - Animate only `transform`, `opacity`, `background-color`, and `color`.
   - Respect `prefers-reduced-motion`.

2. Page loading is local and stable.
   - Keep app shell and page heading stable after route transition.
   - Show loading only in table/content regions.
   - Use abort controllers or equivalent cleanup for in-flight fetches when users switch screens quickly.
   - Preserve previous route interaction quality without masking API errors.

3. Backend optimization follows measurement.
   - Add a local benchmark script for the scoped APIs.
   - Seed or generate the benchmark size deterministically.
   - Fail any scoped API above 500ms after warm-up.
   - Optimize only endpoints that fail, using pagination, bounded queries, indexes, or aggregation changes that preserve response semantics.

## Data Safety

Annotation data safety is a blocking requirement. The implementation must keep existing draft, submit, autosave, reload, and assignment persistence behavior intact.

The following flows must continue passing:

- Annotator saves a metric draft, reloads the task, and sees the saved value.
- Annotator submits a task, reloads the task, and sees completed metric values and notes.
- Admin assigns dataset rows without duplicate or missing assignment records beyond the existing overlap rules.
- Dataset append rejects missing required display fields and allows extra fields.

Read-only API caching or prefetching is allowed for list/detail screens. Mutation paths for draft, submit, import, append, assignment, and role changes must remain uncached and must continue to use the current server-side validation.

## Meta-Harness Rubric

Target score: 8/10 or higher within 3 iterations.

Criteria:

1. Responsiveness
   - Active navigation state updates within 100ms after click in desktop and mobile navigation.
   - Shell/header never blanks during route transitions.
   - Page loading is local to content regions.

2. API Latency
   - Scoped list/detail APIs complete in 500ms or less on the benchmark dataset after warm-up.
   - Slow endpoints have evidence-backed fixes, not broad rewrites.

3. Data Safety
   - Existing dataset and annotation persistence tests pass.
   - Draft/submit/reload behavior remains verified by Playwright.
   - No mutation path uses unsafe client caching.

4. Craft
   - Motion is restrained and uses transform/opacity/background/color only.
   - Reduced-motion users get non-animated state changes.
   - No visible UI copy includes banned en dash or em dash characters.
   - No layout shift or full-page skeleton replaces the app shell.

## Verification Plan

Run these checks before claiming success:

- `pnpm run typecheck`
- `pnpm run test:datasets`
- API benchmark script against local benchmark seed
- Playwright smoke that measures immediate nav active state
- Full `pnpm run test:e2e`
- `pnpm run build`
- Herdr review lanes for UI/motion and backend/data-safety findings when implementation changes both surfaces

## Expected Implementation Boundaries

Likely files:

- `src/components/app-sidebar.tsx`
- `src/components/app-mobile-nav.tsx`
- Optional shared nav helper/component under `src/components/`
- `src/app/admin/dashboard/page.tsx`
- `src/app/admin/datasets/page.tsx`
- `src/app/admin/members/page.tsx`
- `src/app/annotator/tasks/page.tsx`
- API routes listed in Scope only if benchmark evidence shows they fail
- Tests under `tests/e2e/` and `tests/datasets/`
- Benchmark or seed scripts under `scripts/` or `tests/performance/`

Keep edits surgical. Do not touch deployment configuration unless benchmark or verification proves it is required.
