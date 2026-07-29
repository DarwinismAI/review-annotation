ALTER TABLE annotation_assignments
  ADD COLUMN IF NOT EXISTS skipped_at TIMESTAMPTZ;

ALTER TABLE annotation_assignments
  ADD COLUMN IF NOT EXISTS skip_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS annotation_assignments_group_queue_idx
  ON annotation_assignments(annotator_id, assignment_run_id, status, skipped_at, assigned_at);

ALTER TABLE dataset_imports
  ADD COLUMN IF NOT EXISTS target_row_count INTEGER;

ALTER TABLE dataset_imports
  ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE dataset_imports
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

ALTER TABLE dataset_imports
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS dataset_imports_dataset_status_idx
  ON dataset_imports(dataset_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS annotation_adjudications (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  row_id TEXT NOT NULL REFERENCES dataset_rows(id) ON DELETE CASCADE,
  metric_id TEXT NOT NULL REFERENCES annotation_metrics(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  reviewer_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  value TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT annotation_adjudications_row_metric_unique UNIQUE(row_id, metric_id)
);

CREATE INDEX IF NOT EXISTS annotation_adjudications_dataset_row_idx
  ON annotation_adjudications(dataset_id, row_id);
