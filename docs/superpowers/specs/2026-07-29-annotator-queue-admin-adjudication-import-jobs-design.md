# Annotator Queue, Admin Adjudication, And Import Jobs Design

## Goal

Move the annotation product from row-by-row task lists toward a normal annotation workflow:

- Annotators work from task queues grouped by `dataset + assignment run`.
- Admins and superadmins can inspect any log in a full detail page, see what annotators see, and add a separate reviewer/adjudication decision.
- Large or repeated imports do not make dataset screens feel stuck; import work is visible as jobs with progress and blocking rules.

This design preserves existing annotation data. It should add queue/adjudication behavior around the current row-level assignment model instead of rewriting submitted annotation results.

## Product References

The design follows common annotation-product patterns:

- Argilla distributes annotation work through pending queues and tracks completed/pending progress per dataset and user: <https://docs.argilla.io/latest/how_to_guides/distribution/>.
- Langfuse uses annotation queues tied to score configs, assigned users, and a complete-and-next workflow: <https://langfuse.com/docs/evaluation/evaluation-methods/annotation-queues>.
- Prodigy separates multi-annotator review into a reviewer step that resolves conflicts into one final master annotation: <https://prodi.gy/docs/recipes#review>.
- Label Studio supports skip behavior from the labeling stream and keeps skipped tasks visible for operational tracking: <https://labelstud.io/guide/skip.html>.

## Scope

### In Scope

- Replace the annotator landing surface with task groups.
- Define a random next-item flow for annotators.
- Add temporary skip behavior.
- Add full admin/superadmin log detail route.
- Add reviewer/adjudication data separate from annotator votes.
- Add import job visibility and blocking rules.
- Improve loading for dataset list, dataset rows, and annotator task groups.
- Keep JSONL/detail field display contract intact.
- Keep admin/superadmin permissions for review/adjudication; annotators only see their assigned work.

### Out Of Scope

- Deleting existing imported datasets or annotation results.
- Replacing the entire assignment schema with a new queue engine in the first pass.
- Changing rubric CRUD or metric definitions.
- Real-time collaborative locking between annotators beyond the current assignment ownership.
- Model-assisted annotation.

## Data Model Direction

Keep `annotation_assignments` as the atomic unit of work. A task group is a derived or lightly persisted grouping of assignments that share:

- `dataset_id`
- `assignment_run_id` if the schema already has it, or a stable derived run key from assignment metadata and assigned time if not
- annotator id
- metric set

If no assignment-run concept exists yet, add the smallest explicit field needed to make grouping stable for future assigns. Do not infer long-term grouping only from timestamps if that would make reassignment or export ambiguous.

Add a separate adjudication record for reviewer decisions:

- `dataset_id`
- `row_id`
- reviewer user id
- metric id or metric key
- final value
- note
- created/updated/submitted timestamp

Annotator results remain unchanged. Reviewer decisions are not counted as annotator overlap/agreement votes.

Skip is temporary. It should update assignment queue state or skip metadata without deleting drafts or results. A skipped item remains eligible for the same annotator after other available items have been attempted.

## Annotator Queue UX

`/annotator/tasks` becomes a task-group list instead of one row per assignment.

Each task group shows:

- Dataset name.
- Assignment run label or assigned timestamp.
- Remaining rows.
- Submitted rows.
- Temporarily skipped rows.
- Total assigned rows.
- Metric labels from the assigned rubric.
- Status: not started, in progress, completed.

Clicking a task group opens a full annotation workspace.

The workspace loads one eligible assignment chosen randomly by the backend. Eligible means:

- assignment belongs to the current annotator;
- assignment belongs to the selected task group;
- assignment is not completed;
- skipped items are deprioritized while non-skipped eligible items remain.

The annotation workspace shows:

- dataset title and progress for the current task group;
- row detail fields from dataset `displayConfig.detailFields`;
- pass/failed metric controls from the assigned rubric;
- notes per metric;
- autosave status;
- `Submit` and `Skip` actions.

After `Submit`, the backend must save all required metric results and mark the assignment completed in one transaction. The response returns the next random assignment in the same group or a completed state if none remain.

After `Skip`, the backend marks the item skipped temporarily and returns the next random assignment. Skip does not erase existing draft values.

## Admin Log Detail UX

Admin and superadmin dataset row tables must allow opening a full page:

`/admin/datasets/:datasetId/rows/:rowId`

The existing dialog can remain only as a transitional preview if useful, but the product route should be the full page.

The page has three regions:

1. Log detail
   - Shows fields from dataset `displayConfig.detailFields`.
   - Uses the same field projection as annotator detail so admin sees what annotators see.

2. Annotation target
   - Shows the metrics/rubric annotators are expected to answer.
   - Shows pass/failed options and metric descriptions.
   - This region is read-only unless the admin is adding reviewer adjudication.

3. Annotator results and adjudication
   - Shows every assignment for the row.
   - Shows annotator name/email, assignment status, metric values, notes, timestamps, completed count, overlap, and agreement.
   - Shows empty states for unassigned rows, assigned-but-not-submitted rows, and no-agreement rows.
   - Allows admin/superadmin to save reviewer adjudication separately from annotator votes.

Navigation behavior:

- Back to dataset rows preserves page/search/filter.
- Prev/next follows the current dataset row filter when available.
- Open random unresolved/conflict row is available for review workflow.

## Import Jobs UX

Dataset and import work are separated:

- Dataset is the long-lived work object used for rows, assign, review, and export.
- Import job is the upload/append process with status and progress.

Import job statuses:

- `queued`
- `running`
- `completed`
- `failed`
- `canceled`

Dataset readiness derives from completed import jobs. A dataset with active import jobs remains blocked from assignment.

The dataset list should not show many duplicate-looking stuck `importing` datasets without explanation. It should show import status with a link to the latest job and filters for ready/importing/failed.

Import job detail shows:

- dataset;
- source filename;
- uploaded by;
- row target;
- inserted rows;
- status;
- started/completed timestamps;
- last error;
- retry/cancel action where safe.

Blocking rules:

- If a dataset has an active `queued` or `running` job, block another import for that dataset.
- Enforce a configured maximum row count per import.
- For append imports, the new file may contain extra fields but must not miss fields selected for display in the original dataset contract.
- Assignment API must reject non-ready datasets.
- Import completion must be based on persisted inserted-row count, not only client-side final chunk state.

## Loading And Performance

Dataset list:

- Server-side pagination, search, and filters stay in the dataset list API.
- Counts should be bounded to the visible page and summary totals.
- Failed/importing jobs are filterable so admins can clear operational clutter without deleting data.

Dataset detail rows:

- Replace fixed `pageSize=200` behavior with server-side pagination.
- Add search/filter for row id, text fields, completion status, overlap, and agreement/conflict where feasible.
- Fetch row detail only when opening a row detail page.

Annotator tasks:

- `/api/annotator/tasks` returns task groups and aggregate counts, not every assignment row.
- The random next endpoint returns one assignment at a time.
- Draft and submit endpoints remain uncached mutation paths.

UI:

- Keep the app shell/sidebar mounted during route changes.
- Show skeletons inside the table/detail region only.
- Do not reload the whole workspace for tab changes.
- Use restrained motion for active/sidebar changes and respect reduced-motion.

## Export Contract

Admin/superadmin can download annotated output for a dataset or filtered subset.

Export includes:

- raw row fields;
- configured list/detail display metadata;
- assignment statuses;
- annotator metric values and notes;
- completed count;
- overlap target;
- agreement/conflict summary;
- reviewer adjudication values and notes when present.

If a row is not adjudicated, export still includes annotator votes and leaves final reviewer decision empty.

Export must not mutate data.

## Data Safety

- Do not delete existing dataset rows, assignment rows, drafts, results, or imports as part of this feature.
- Annotator submit writes metric results and assignment completion transactionally.
- Autosave drafts must survive refresh and skip.
- Reviewer adjudication is versioned or upserted with reviewer/timestamp metadata; it never overwrites annotator votes.
- Admin routes require admin/superadmin.
- Annotator routes enforce current-user assignment ownership.
- Import retries must be idempotent or create a new job with clear lineage; they must not duplicate rows silently.

## API Shape

Likely endpoints:

- `GET /api/annotator/task-groups`
- `GET /api/annotator/task-groups/:groupId/next`
- `POST /api/annotator/tasks/:assignmentId/skip`
- existing `GET /api/annotator/tasks/:assignmentId`
- existing draft and submit endpoints, updated to return next-item hints where useful
- `GET /api/datasets/:datasetId/rows/:rowId`
- `GET /api/datasets/:datasetId/rows/:rowId/adjudication`
- `POST /api/datasets/:datasetId/rows/:rowId/adjudication`
- `GET /api/datasets/:datasetId/import-jobs`
- `GET /api/import-jobs/:jobId`
- `POST /api/import-jobs/:jobId/cancel`
- `POST /api/import-jobs/:jobId/retry`

The exact route names can follow existing app conventions during implementation, but the separation between task group, assignment item, row detail, adjudication, and import job must remain clear.

## Verification

Unit/data tests:

- task group aggregation counts remaining/submitted/skipped/total correctly;
- random next excludes completed assignments and deprioritizes skipped assignments while unskipped assignments remain;
- skip preserves existing draft;
- submit saves all metric results before completion;
- adjudication does not alter annotator result rows;
- append import allows extra fields and rejects missing display-contract fields;
- active import blocks duplicate import for the same dataset.

Playwright:

- annotator sees task groups, opens one, submits an item, and lands on another random eligible item;
- annotator skips an item and sees a different eligible item when available;
- draft survives reload and skip;
- admin opens a dataset row full page from row table;
- admin sees annotator choices and saves reviewer adjudication;
- export includes raw data, annotator votes, and reviewer final decision;
- dataset list and detail row pagination/search/filter remain usable with many uploaded datasets/import jobs;
- superadmin has the same review/adjudication rights as admin.

Performance:

- dataset list API remains bounded by page size;
- dataset detail rows API remains bounded by page size;
- annotator task group list does not load all row assignments;
- random next endpoint fetches one item;
- shell/sidebar remains visible during navigation.

## Implementation Order

1. Backend/data helpers for task group aggregation, random next, skip, and adjudication.
2. Annotator task-group UI and annotation workspace next/skip flow.
3. Admin full row detail route with annotator results and adjudication.
4. Import job status/progress UI and duplicate-import blocking.
5. Dataset-row pagination/search/filter performance pass.
6. Export contract update for reviewer adjudication.
7. Full Playwright flow across annotator, admin, and superadmin.

Use Herdr for implementation after the written implementation plan is approved.
