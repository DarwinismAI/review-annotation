# Dataset Annotation Workflow Design

Date: 2026-07-28
Status: Approved design direction, pending implementation plan

## Goal

Add a dataset-first annotation workflow for safety/compliance datasets. Admins can upload datasets, choose which fields appear in list and detail views, append more rows later when required display fields are present, configure dataset metrics, and assign rows to annotators with balanced overlap.

## Current Permission Model

The current system has two internal roles:

- `admin`: manages imports, datasets, metrics, annotators, assignment, and review aggregation.
- `expert`: performs review tasks.

For this feature, the product wording changes from `expert` to `annotator` in UI copy and navigation. The internal role remains `expert` for this phase to avoid auth and database migrations. Future work can add URL aliases such as `/annotator/*`, but it is not required for the first implementation.

## Chosen Approach

Use a dataset-first model.

Dataset is the durable unit that owns schema inspection, visible fields, metrics, rows, imports, and assignment runs. Assignment is an admin action over dataset rows. This keeps dataset import and annotation operations separate from the existing batch/review implementation, while still allowing the first implementation to reuse existing review screens and tables where practical.

Rejected alternatives:

- Extending only the current batch model would be faster, but it would mix dataset storage with assignment runs and make append/agreement harder to reason about.
- A full project/task/annotation platform is cleaner long term, but too broad for the current slice.

## Dataset Upload

When an admin uploads a new JSON dataset, the system parses sample records and opens a confirm screen.

The confirm screen only asks the admin to choose display fields:

- List fields: fields shown as columns in the dataset row list.
- Detail fields: fields shown in row detail and annotator review.

The admin does not need to choose `id`, `input`, or `label`. The app stores the full raw JSON record and creates an internal row id for every imported row. If a stable source id can be detected, the app may use it for duplicate warnings, but it is not required for import.

The dataset stores:

- Schema fingerprint: key paths and detected value types from the first import.
- Display config: selected list fields and detail fields.
- Required append fields: the union of selected list and detail fields.
- Metrics config: dataset-level metrics and their scales.

## Append Import

When an admin imports more rows into an existing dataset, the new file may include extra fields. It must not miss fields that were selected for list or detail display during initial dataset setup.

Append validation:

- Parse all new rows.
- Verify each required append field exists in every new row.
- Allow additional fields.
- Block import if required fields are missing.
- Return a missing-field report with field path and row indexes/counts.

If validation passes, rows are appended to the same dataset and import history records the source file and row count.

## Dataset Metrics

Metrics are configured at dataset level. Assignment can select a subset of dataset metrics, but annotators only score metrics that belong to the dataset.

For safety/compliance datasets, the default metric examples are:

- Vi phạm chính sách
- Mức độ ẩn ý
- Độ rõ của guideline

Metrics may use a binary scale such as:

- `Failed`
- `Pass`

The backend must validate submitted metric values against the metric scale declared for that dataset.

## Assignment

Assignment is an admin-only action.

Admin chooses:

- Scope: selected rows or entire dataset.
- Target overlap `K`: each row should receive enough annotator submissions to reach `K`.
- Metrics subset: selected from dataset-level metrics.
- Annotators: eligible annotators selected by admin.

Distribution rule:

- One assignment is one annotator plus one row plus a metric subset.
- Each assigned annotator scores all metrics in the assignment.
- Rows that already have enough overlap for the selected metric set are skipped.
- The system assigns missing work to annotators who do not already have that row.
- The system balances load by assigning the next task to the selected annotator with the fewest tasks in the current assignment run.
- If fewer than `K` eligible annotators are selected, assignment is blocked.

## Admin Views

Dataset row list should show:

- Internal row sequence/id.
- Selected list fields.
- Completed annotator count.
- Annotated-by avatars/initials.
- Agreement percentage when at least two submissions exist.
- Overlap state, for example `3/3` or `thiếu 1`.

Dataset detail should support:

- Viewing raw/detail fields selected for the dataset.
- Importing more rows.
- Opening the assign modal.
- Reviewing per-row annotation results and agreement.

## Annotator Views

Annotator-facing UI should use the word `Annotator` instead of `Expert`.

Annotator task list shows assigned rows. Row detail shows only the dataset detail fields and the metrics assigned to that annotator. The review panel should not show SAPO/TLDR/FAQ blocks or claim-specific scoring for this workflow.

## Suggested Data Model

New durable entities:

- `datasets`: name, domain, schema fingerprint, display config, metrics config, created_by.
- `dataset_rows`: dataset_id, internal_row_id, raw_json, import_id, created_at.
- `dataset_imports`: dataset_id, source filename, status, row_count, missing_fields_report.
- `annotation_metrics`: dataset_id, key, label, scale JSON, required.
- `annotation_assignments`: dataset_id, row_id, annotator_id, target_overlap, metric_ids, status.
- `annotation_results`: assignment_id, row_id, annotator_id, metric_id, value, note, submitted_at.

The implementation may bridge these entities to existing `articles`, `assignments`, `rubrics`, and `review_scores` tables in the first phase if that keeps the change smaller. The dataset abstraction should still be the product contract.

## API Shape

Admin APIs:

- `POST /api/datasets/inspect`: parse upload and return schema paths plus sample rows.
- `POST /api/datasets`: create dataset with display fields and metrics.
- `POST /api/datasets/:id/imports/inspect`: inspect append file and report missing display fields.
- `POST /api/datasets/:id/imports`: append rows after validation.
- `POST /api/datasets/:id/assign`: create balanced annotator assignments.
- `GET /api/datasets/:id/rows`: list rows with display fields, completed count, overlap, and agreement.

Annotator APIs:

- `GET /api/annotator/tasks`: list current annotator tasks.
- `GET /api/annotator/tasks/:id`: fetch row detail and assigned metrics.
- `POST /api/annotator/tasks/:id/submit`: submit metric results.

Internal route names may still use `expert` in phase one if changing URLs would expand scope. UI copy should say annotator.

## Edge Cases

- Empty upload: block with a clear error.
- Invalid JSON or non-array JSON: block with a clear error.
- Append file missing display fields: block and report missing field paths.
- Append file has extra fields: allow.
- Duplicate source id detected: warn or skip according to implementation plan; absence of source id must not block import.
- Not enough selected annotators for overlap: block assignment.
- Row already at target overlap: skip.
- Annotator inactive: exclude from new assignments; preserve existing assignments for audit.
- Metric removed after assignment: preserve existing assignment results and prevent new assignment using that metric.

## Verification Targets

- Upload inspect returns selectable list/detail field paths for `humanity_output.json`.
- Creating a dataset stores list/detail fields and dataset metrics.
- Append import accepts files with extra fields.
- Append import rejects files missing selected display fields.
- Balanced assignment creates exactly the missing overlap without assigning the same row twice to one annotator.
- Annotator task detail renders only selected detail fields and assigned metrics.
- Submitting a metric value outside the declared scale is rejected.
- Admin row list shows completed count, annotated-by, agreement, and overlap.
