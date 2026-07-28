CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  schema_fingerprint JSONB NOT NULL,
  display_config JSONB NOT NULL,
  required_append_fields JSONB NOT NULL,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dataset_imports (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  source_filename TEXT NOT NULL,
  status TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  missing_fields_report JSONB,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dataset_rows (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  import_id TEXT NOT NULL REFERENCES dataset_imports(id) ON DELETE CASCADE,
  internal_row_id INTEGER NOT NULL,
  raw_json JSONB NOT NULL,
  source_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS annotation_metrics (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  scale_json JSONB NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS annotation_assignment_runs (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  target_overlap INTEGER NOT NULL,
  metric_ids JSONB NOT NULL,
  scope TEXT NOT NULL,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS annotation_assignments (
  id TEXT PRIMARY KEY,
  assignment_run_id TEXT NOT NULL REFERENCES annotation_assignment_runs(id) ON DELETE CASCADE,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  row_id TEXT NOT NULL REFERENCES dataset_rows(id) ON DELETE CASCADE,
  annotator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  metric_ids JSONB NOT NULL,
  metric_key TEXT NOT NULL,
  target_overlap INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'assigned',
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS annotation_results (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES annotation_assignments(id) ON DELETE CASCADE,
  row_id TEXT NOT NULL REFERENCES dataset_rows(id) ON DELETE CASCADE,
  annotator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  metric_id TEXT NOT NULL REFERENCES annotation_metrics(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  note TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS dataset_rows_dataset_internal_row_unique ON dataset_rows(dataset_id, internal_row_id);
CREATE INDEX IF NOT EXISTS dataset_rows_dataset_idx ON dataset_rows(dataset_id);
CREATE UNIQUE INDEX IF NOT EXISTS annotation_metrics_dataset_key_unique ON annotation_metrics(dataset_id, key);
CREATE UNIQUE INDEX IF NOT EXISTS annotation_assignments_row_annotator_metric_unique ON annotation_assignments(row_id, annotator_id, metric_key);
CREATE INDEX IF NOT EXISTS annotation_assignments_dataset_idx ON annotation_assignments(dataset_id);
CREATE INDEX IF NOT EXISTS annotation_assignments_annotator_idx ON annotation_assignments(annotator_id);
CREATE UNIQUE INDEX IF NOT EXISTS annotation_results_assignment_metric_unique ON annotation_results(assignment_id, metric_id);
CREATE INDEX IF NOT EXISTS annotation_results_row_metric_idx ON annotation_results(row_id, metric_id);
