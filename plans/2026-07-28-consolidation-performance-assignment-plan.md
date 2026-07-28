# Consolidation, Performance, Assignment Rule Plan

**Goal:** Reduce duplicated admin flows, remove avoidable loading paths, and make dataset assignment support a per-annotator row quota.

**Scope Locked**
- Keep `Datasets` as the primary upload/import flow for the current review-annotation product.
- Hide legacy `Đợt upload` article/batch flow from the main sidebar. Keep routes/API reachable for backward compatibility unless explicitly deleted later.
- Merge `Annotator` and `Phân quyền` into one `Thành viên` entry/page. Superadmin can change role there; admin can still manage annotator active/inactive status where allowed.
- Add assignment rule: each selected annotator can receive up to `N` rows in an assignment run. Existing overlap behavior remains the default when quota is empty.
- Performance target: remove old-dashboard/batch requests from normal admin navigation, reduce repeated auth/session fetches, and keep dataset/list/task APIs bounded by pagination or grouped queries.

**Implementation Tasks**
1. Navigation consolidation
   - Modify `src/components/app-sidebar.tsx` and `src/components/app-mobile-nav.tsx`.
   - Remove `/admin/batches` from visible nav.
   - Replace separate `Annotator` and `Phân quyền` entries with one `/admin/members` entry labeled `Thành viên`.
   - Keep role visibility: members page visible to admin/superadmin, but role-changing controls only work for superadmin.

2. Unified members page/API
   - Extend `src/app/api/admin/members/route.ts` to return profile role plus annotator profile status/domain fields in one response.
   - Allow admins to view members. Keep role `PATCH` superadmin-only.
   - Either add a status patch path or reuse `/api/annotators/[id]` from the page for active/inactive annotator status.
   - Replace `src/app/admin/members/page.tsx` with a table covering member identity, role, annotator status/domain, and actions.
   - Keep `/admin/annotators` route as a compatibility redirect or thin alias to `/admin/members`.

3. Assignment quota rule
   - Update `src/lib/datasets/assignment.ts` so `planBalancedAssignments` optionally accepts `maxRowsPerAnnotator`.
   - Interpret quota as max distinct rows assigned per annotator in the current run for the selected metric group.
   - If quota prevents filling target overlap, skip only rows that cannot be filled and return `skippedRowIds`.
   - Update `src/app/api/datasets/[id]/assign/route.ts` request schema and response.
   - Update `src/components/admin/dataset-assign-modal.tsx` with a numeric input for "Số câu tối đa / annotator".

4. Backend performance cleanup
   - Remove admin dashboard dependency on legacy batch APIs from the default nav path by routing `/admin` to `/admin/datasets`.
   - Optimize `/api/datasets` to avoid fetching all imports when only latest import filename per dataset is needed.
   - Add pagination support to `/api/annotator/tasks` and keep default page size bounded.
   - Update annotator tasks page to consume paginated response without loading all assignments forever.

5. Verification
   - Add unit tests for assignment quota.
   - Extend Playwright E2E to assert members page works for superadmin/admin and assignment quota creates bounded work.
   - Run `pnpm run test:datasets`, `pnpm run typecheck`, `pnpm run test:e2e`, `pnpm run build`.
   - Run browser smoke on local server for admin dataset list/detail, members, assignment modal, and annotator task list.
