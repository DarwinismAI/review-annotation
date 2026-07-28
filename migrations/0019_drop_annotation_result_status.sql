-- annotation result draft/completed state is tracked by annotation_assignments.status.
-- Keep annotation_results focused on saved metric values so old databases that never
-- received 0018 do not need a new column before annotators can save work.
DROP INDEX IF EXISTS "annotation_results_assignment_status_idx";
DROP INDEX IF EXISTS "annotation_results_row_metric_status_idx";
ALTER TABLE "annotation_results" DROP CONSTRAINT IF EXISTS "annotation_results_status_check";
ALTER TABLE "annotation_results" DROP COLUMN IF EXISTS "status";
