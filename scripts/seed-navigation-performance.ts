import { createClient } from "@libsql/client";
import { mkdirSync } from "node:fs";

const DB_PATH = process.env.LOCAL_DB_PATH ?? "file:.tmp/navigation-performance.db";
const ADMIN_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_ANNOTATOR_ID = "00000000-0000-0000-0000-000000000002";
const DATASET_COUNT = 10;
const ROWS_PER_DATASET = 1000;

const DDL = `
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'annotator' CHECK(role IN ('superadmin', 'admin', 'annotator')),
  name TEXT,
  image TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS expert_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK(domain IN ('law', 'medical', 'tourism', 'safety_compliance')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'inactive')),
  invite_token TEXT UNIQUE,
  invite_expires_at INTEGER,
  invited_at INTEGER NOT NULL,
  activated_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  schema_fingerprint TEXT NOT NULL,
  display_config TEXT NOT NULL,
  required_append_fields TEXT NOT NULL,
  created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dataset_imports (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  source_filename TEXT NOT NULL,
  status TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  target_row_count INTEGER,
  error_message TEXT,
  missing_fields_report TEXT,
  created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dataset_rows (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  import_id TEXT NOT NULL REFERENCES dataset_imports(id) ON DELETE CASCADE,
  internal_row_id INTEGER NOT NULL,
  raw_json TEXT NOT NULL,
  source_id TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS dataset_rows_dataset_internal_row_unique ON dataset_rows(dataset_id, internal_row_id);
CREATE INDEX IF NOT EXISTS dataset_rows_dataset_idx ON dataset_rows(dataset_id);
CREATE TABLE IF NOT EXISTS annotation_metrics (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  scale_json TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS annotation_metrics_dataset_key_unique ON annotation_metrics(dataset_id, key);
CREATE TABLE IF NOT EXISTS annotation_assignment_runs (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  target_overlap INTEGER NOT NULL,
  metric_ids TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS annotation_assignments (
  id TEXT PRIMARY KEY,
  assignment_run_id TEXT NOT NULL REFERENCES annotation_assignment_runs(id) ON DELETE CASCADE,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  row_id TEXT NOT NULL REFERENCES dataset_rows(id) ON DELETE CASCADE,
  annotator_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  metric_ids TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  target_overlap INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'assigned',
  skipped_at TEXT,
  skip_count INTEGER NOT NULL DEFAULT 0,
  assigned_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS annotation_assignments_row_annotator_metric_unique ON annotation_assignments(row_id, annotator_id, metric_key);
CREATE INDEX IF NOT EXISTS annotation_assignments_dataset_idx ON annotation_assignments(dataset_id);
CREATE INDEX IF NOT EXISTS annotation_assignments_annotator_idx ON annotation_assignments(annotator_id);
CREATE INDEX IF NOT EXISTS annotation_assignments_group_queue_idx ON annotation_assignments(annotator_id, assignment_run_id, status, skipped_at, assigned_at);
CREATE TABLE IF NOT EXISTS annotation_results (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES annotation_assignments(id) ON DELETE CASCADE,
  row_id TEXT NOT NULL REFERENCES dataset_rows(id) ON DELETE CASCADE,
  annotator_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  metric_id TEXT NOT NULL REFERENCES annotation_metrics(id) ON DELETE CASCADE,
  value TEXT,
  note TEXT,
  submitted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS annotation_results_assignment_metric_unique ON annotation_results(assignment_id, metric_id);
CREATE INDEX IF NOT EXISTS annotation_results_row_metric_idx ON annotation_results(row_id, metric_id);
CREATE TABLE IF NOT EXISTS annotation_adjudications (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  row_id TEXT NOT NULL REFERENCES dataset_rows(id) ON DELETE CASCADE,
  metric_id TEXT NOT NULL REFERENCES annotation_metrics(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  reviewer_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  value TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  submitted_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS annotation_adjudications_row_metric_unique ON annotation_adjudications(row_id, metric_id);
CREATE INDEX IF NOT EXISTS annotation_adjudications_dataset_row_idx ON annotation_adjudications(dataset_id, row_id);
`;

const schemaFingerprint = JSON.stringify([
  { path: "source_id", type: "string", sample: "nav-perf-01-0001" },
  { path: "prompt", type: "string", sample: "Review response 1" },
  { path: "response", type: "string", sample: "Deterministic answer text" },
  { path: "category", type: "string", sample: "safety_compliance" },
]);
const displayConfig = JSON.stringify({
  listFields: ["source_id", "prompt", "category"],
  detailFields: ["source_id", "prompt", "response", "category"],
});
const requiredAppendFields = JSON.stringify(["source_id", "prompt", "category", "response"]);
const scaleJson = JSON.stringify({ values: ["pass", "fail"] });
const metricIds = (datasetIndex: number) => [`nav_perf_metric_${pad(datasetIndex)}`];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function annotatorId(index: number): string {
  if (index === 1) return DEFAULT_ANNOTATOR_ID;
  return `00000000-0000-0000-0000-${String(100 + index).padStart(12, "0")}`;
}

async function ensureSchema(client: ReturnType<typeof createClient>) {
  await client.executeMultiple(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; ${DDL}`);
}

async function seedUsers(client: ReturnType<typeof createClient>, nowIso: string, nowMs: number) {
  await client.execute({
    sql: `DELETE FROM profiles WHERE email LIKE 'nav-perf-annotator-%@review-annotation.local'`,
  });

  await client.execute({
    sql: `INSERT INTO profiles (id, email, role, name, created_at, updated_at)
          VALUES (?, ?, 'admin', 'Admin', ?, ?)
          ON CONFLICT(id) DO UPDATE SET email = excluded.email, role = excluded.role, name = excluded.name, updated_at = excluded.updated_at`,
    args: [ADMIN_ID, "admin@review-annotation.local", nowIso, nowIso],
  });

  for (let index = 1; index <= 10; index++) {
    const id = annotatorId(index);
    await client.execute({
      sql: `INSERT INTO profiles (id, email, role, name, created_at, updated_at)
            VALUES (?, ?, 'annotator', ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET email = excluded.email, role = excluded.role, name = excluded.name, updated_at = excluded.updated_at`,
      args: [id, index === 1 ? "annotator@review-annotation.local" : `nav-perf-annotator-${index}@review-annotation.local`, `Perf Annotator ${index}`, nowIso, nowIso],
    });
    await client.execute({
      sql: `INSERT INTO expert_profiles
            (id, user_id, domain, status, invite_token, invite_expires_at, invited_at, activated_at, created_at, updated_at)
            VALUES (?, ?, 'safety_compliance', 'active', NULL, NULL, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET domain = excluded.domain, status = excluded.status, activated_at = excluded.activated_at, updated_at = excluded.updated_at`,
      args: [`nav_perf_expert_profile_${pad(index)}`, id, nowMs, nowMs, nowMs, nowMs],
    });
  }
}

function rawRow(datasetIndex: number, rowIndex: number) {
  const suffix = `${pad(datasetIndex)}-${String(rowIndex).padStart(4, "0")}`;
  return {
    source_id: `nav-perf-${suffix}`,
    prompt: `Navigation performance review prompt ${suffix}`,
    response: `Deterministic response body for navigation performance row ${suffix}.`,
    category: "safety_compliance",
  };
}

async function seedDataset(client: ReturnType<typeof createClient>, datasetIndex: number, nowIso: string) {
  const datasetId = `nav_perf_dataset_${pad(datasetIndex)}`;
  const importId = `nav_perf_import_${pad(datasetIndex)}`;
  const metricId = metricIds(datasetIndex)[0];
  const runId = `nav_perf_assignment_run_${pad(datasetIndex)}`;
  const metricIdJson = JSON.stringify([metricId]);

  await client.execute({
    sql: `DELETE FROM datasets WHERE id = ?`,
    args: [datasetId],
  });
  await client.execute({
    sql: `INSERT INTO datasets
          (id, name, domain, status, schema_fingerprint, display_config, required_append_fields, created_by, created_at, updated_at)
          VALUES (?, ?, 'safety_compliance', 'ready', ?, ?, ?, ?, ?, ?)`,
    args: [datasetId, `Navigation Performance ${pad(datasetIndex)}`, schemaFingerprint, displayConfig, requiredAppendFields, ADMIN_ID, nowIso, nowIso],
  });
  await client.execute({
    sql: `INSERT INTO dataset_imports
          (id, dataset_id, source_filename, status, row_count, missing_fields_report, created_by, created_at)
          VALUES (?, ?, ?, 'completed', ?, NULL, ?, ?)`,
    args: [importId, datasetId, `navigation-performance-${pad(datasetIndex)}.json`, ROWS_PER_DATASET, ADMIN_ID, nowIso],
  });
  await client.execute({
    sql: `INSERT INTO annotation_metrics
          (id, dataset_id, key, label, description, scale_json, required, sort_order, created_at, updated_at)
          VALUES (?, ?, 'quality', 'Quality', 'Binary quality judgment', ?, 1, 0, ?, ?)`,
    args: [metricId, datasetId, scaleJson, nowIso, nowIso],
  });
  await client.execute({
    sql: `INSERT INTO annotation_assignment_runs
          (id, dataset_id, target_overlap, metric_ids, scope, created_by, created_at)
          VALUES (?, ?, 1, ?, 'all', ?, ?)`,
    args: [runId, datasetId, metricIdJson, ADMIN_ID, nowIso],
  });

  for (let rowIndex = 1; rowIndex <= ROWS_PER_DATASET; rowIndex++) {
    const rowId = `${datasetId}_row_${String(rowIndex).padStart(4, "0")}`;
    const owner = annotatorId(((rowIndex - 1) % 10) + 1);
    await client.execute({
      sql: `INSERT INTO dataset_rows
            (id, dataset_id, import_id, internal_row_id, raw_json, source_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [rowId, datasetId, importId, rowIndex, JSON.stringify(rawRow(datasetIndex, rowIndex)), `nav-perf-${pad(datasetIndex)}-${String(rowIndex).padStart(4, "0")}`, nowIso],
    });
    await client.execute({
      sql: `INSERT INTO annotation_assignments
            (id, assignment_run_id, dataset_id, row_id, annotator_id, metric_ids, metric_key, target_overlap, status, assigned_at, completed_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'quality', 1, 'assigned', ?, NULL, ?, ?)`,
      args: [`${datasetId}_assignment_${String(rowIndex).padStart(4, "0")}`, runId, datasetId, rowId, owner, metricIdJson, nowIso, nowIso, nowIso],
    });
  }
}

async function main() {
  mkdirSync(".tmp", { recursive: true });
  const client = createClient({ url: DB_PATH });
  const now = new Date("2026-07-29T00:00:00.000Z");
  const nowIso = now.toISOString();
  const nowMs = now.getTime();

  try {
    await ensureSchema(client);
    await seedUsers(client, nowIso, nowMs);
    for (let datasetIndex = 1; datasetIndex <= DATASET_COUNT; datasetIndex++) {
      await seedDataset(client, datasetIndex, nowIso);
    }

    console.log(`Seeded navigation performance data in ${DB_PATH}`);
    console.log(`Datasets: ${DATASET_COUNT}`);
    console.log(`Rows per dataset: ${ROWS_PER_DATASET}`);
    console.log("Active annotators: 10");
    console.log(`Default annotator assignments: ${DATASET_COUNT * (ROWS_PER_DATASET / 10)}`);
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error("seed-navigation-performance failed:", error);
  process.exit(1);
});
