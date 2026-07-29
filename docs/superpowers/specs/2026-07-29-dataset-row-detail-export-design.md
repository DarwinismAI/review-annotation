# Dataset Row Detail And Annotated Export Design

## Goal

Improve the Dataset admin workflow so admins can inspect each imported data row, see annotation progress for that row, and download annotated output without crowding the list view.

## Scope

- Admin Dataset detail list uses only dataset `displayConfig.listFields`.
- Admin can click a row to open a row detail view.
- Row detail shows dataset `displayConfig.detailFields`, annotation completion, annotators, metric values, notes, and agreement.
- Admin can download annotated rows as JSONL from a dataset detail page.
- Annotator task detail keeps showing detail fields for the assigned task; no separate annotator browsing surface is added.

## Field Display Contract

For the current production JSONL dataset:

| Field | List | Detail |
|---|---:|---:|
| `input` | yes | yes |
| `intent` | yes | yes |
| `sub_intent` | yes | yes |
| `group` | no | yes |
| `severity` | no | yes |
| `definition` | no | yes |
| `match_when` | no | yes |
| `do_not_match` | no | yes |
| `example_match` | no | yes |
| `example_no_match` | no | yes |
| `example_boundary` | no | yes |

Existing datasets continue to use their saved `displayConfig`. The production import script already writes the contract above.

## Admin Dataset List

The dataset detail page should request list rows with `fields=list` and pass `displayConfig.listFields` into the table. The table should keep stable utility columns:

- Row id.
- Selected checkbox.
- Configured list fields.
- Completed count.
- Annotated by.
- Agreement.
- Overlap.
- A row-open affordance.

Clicking a row, excluding checkbox clicks, opens the row detail panel.

## Admin Row Detail

Use a modal or right-side panel. The first implementation should use an existing dialog/modal component to avoid changing page layout.

The detail fetch should be per-row, not by loading every row with all detail fields. The response should include:

- `rawJson` projected by `detailFields`.
- `completedCount`, `targetOverlap`, `overlapLabel`, and `agreement`.
- Assignments for that row: annotator id/name/image, assignment status.
- Completed annotation results grouped by assignment/annotator, with metric label/key/value/note/submitted time.

Empty states:

- No assignments: show `Chưa assign`.
- Assigned but no completed annotations: show `Chưa có annotator submit`.
- No agreement yet: show `-`.

## Annotator View

Annotator task detail already fetches one assignment and projects `displayConfig.detailFields`. Keep that behavior. Do not add dataset-wide browsing for annotators because it can expose rows they were not assigned.

## Annotated Download

Add admin-only endpoint:

`GET /api/datasets/:id/export?format=jsonl`

The response downloads `application/x-ndjson` with one JSON object per dataset row:

```json
{
  "row_id": 1,
  "source_id": "source-id-or-null",
  "data": {},
  "annotation": {
    "completed_count": 2,
    "target_overlap": 3,
    "agreement": 91,
    "annotated_by": [{"id": "...", "name": "..."}],
    "results": [
      {
        "assignment_id": "...",
        "annotator": {"id": "...", "name": "..."},
        "status": "completed",
        "metrics": {
          "policy_violation": {"label": "Vi phạm chính sách", "value": "Pass", "note": "..."}
        }
      }
    ]
  }
}
```

Export should include rows even when unannotated. It must not mutate data.

## Data Safety

- Admin-only routes use `requireAdmin`.
- Annotator routes continue to require the assignment owner.
- Existing annotation rows are read only for display/export.
- Do not delete or rewrite existing dataset rows, assignments, or annotation results.

## Verification

- Unit/helper test for row progress export shaping if a helper is added.
- Dataset e2e should verify:
  - Admin list renders only configured list fields.
  - Clicking a row opens detail fields.
  - Detail includes completed count/overlap.
  - Download endpoint returns JSONL.
- Existing full flow must still pass.
