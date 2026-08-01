import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../../src/db/schema.sqlite";
import * as datasetsSchema from "../../src/db/datasets.sqlite";
import { listTaskGroupsForAnnotator } from "../../src/lib/datasets/task-groups-read";

const client = createClient({ url: `file:${join(mkdtempSync(join(tmpdir(), "task-groups-sqlite-")), "local.db")}` });
const db = drizzle(client, { schema: { ...schema, ...datasetsSchema } }) as any;

const now = "2026-08-01T00:00:00.000Z";

async function exec(sql: string, args: Array<string | number | null> = []) {
  await client.execute({ sql, args });
}

async function main() {
  await exec(`create table profiles (id text primary key, email text not null unique, role text not null, name text, image text, created_at text not null, updated_at text not null)`);
  await exec(`create table datasets (id text primary key, name text not null, domain text not null, status text not null, schema_fingerprint text not null, display_config text not null, required_append_fields text not null, created_by text, created_at text not null, updated_at text not null)`);
  await exec(`create table dataset_imports (id text primary key, dataset_id text not null, source_filename text not null, status text not null, row_count integer not null default 0, target_row_count integer, error_message text, missing_fields_report text, created_by text, started_at text, completed_at text, created_at text not null)`);
  await exec(`create table dataset_rows (id text primary key, dataset_id text not null, import_id text not null, internal_row_id integer not null, raw_json text not null, source_id text, created_at text not null)`);
  await exec(`create table annotation_metrics (id text primary key, dataset_id text not null, key text not null, label text not null, description text, scale_json text not null, required integer not null default 1, sort_order integer not null default 0, created_at text not null, updated_at text not null)`);
  await exec(`create table annotation_assignment_runs (id text primary key, dataset_id text not null, target_overlap integer not null, metric_ids text not null, scope text not null, created_by text, created_at text not null)`);
  await exec(`create table annotation_assignments (id text primary key, assignment_run_id text not null, dataset_id text not null, row_id text not null, annotator_id text not null, metric_ids text not null, metric_key text not null, target_overlap integer not null, status text not null default 'assigned', skipped_at text, skip_count integer not null default 0, assigned_at text not null, completed_at text, created_at text not null, updated_at text not null)`);

  await exec(`insert into profiles (id, email, role, name, created_at, updated_at) values (?, ?, 'annotator', 'Annotator', ?, ?)`, ["ann-1", "ann@example.com", now, now]);
  await exec(`insert into datasets (id, name, domain, status, schema_fingerprint, display_config, required_append_fields, created_at, updated_at) values ('ds-1', 'Dataset One', 'law', 'ready', '[]', '{"listFields":[],"detailFields":[]}', '[]', ?, ?)`, [now, now]);
  await exec(`insert into dataset_imports (id, dataset_id, source_filename, status, created_at) values ('imp-1', 'ds-1', 'source.json', 'completed', ?)`, [now]);
  await exec(`insert into dataset_rows (id, dataset_id, import_id, internal_row_id, raw_json, created_at) values ('row-1', 'ds-1', 'imp-1', 1, '{}', ?), ('row-2', 'ds-1', 'imp-1', 2, '{}', ?), ('row-3', 'ds-1', 'imp-1', 3, '{}', ?)`, [now, now, now]);
  await exec(`insert into annotation_metrics (id, dataset_id, key, label, scale_json, sort_order, created_at, updated_at) values ('m-1', 'ds-1', 'm1', 'First', '{"values":["Pass","Fail"]}', 0, ?, ?), ('m-2', 'ds-1', 'm2', 'Second', '{"values":["Pass","Fail"]}', 1, ?, ?)`, [now, now, now, now]);
  await exec(`insert into annotation_assignment_runs (id, dataset_id, target_overlap, metric_ids, scope, created_at) values ('run-1', 'ds-1', 2, ?, 'all', ?)`, [JSON.stringify(["m-2", "missing", "m-1", "m-1"]), now]);
  await exec(
    `insert into annotation_assignments (id, assignment_run_id, dataset_id, row_id, annotator_id, metric_ids, metric_key, target_overlap, status, skipped_at, assigned_at, created_at, updated_at)
     values
     ('a-1', 'run-1', 'ds-1', 'row-1', 'ann-1', ?, 'm2', 2, 'assigned', null, ?, ?, ?),
     ('a-2', 'run-1', 'ds-1', 'row-2', 'ann-1', ?, 'm1', 2, 'completed', null, ?, ?, ?),
     ('a-3', 'run-1', 'ds-1', 'row-3', 'ann-1', ?, 'm1', 2, 'assigned', ?, ?, ?, ?)`,
    [
      JSON.stringify(["m-2", "missing", "m-1", "m-1"]), now, now, now,
      JSON.stringify(["m-2", "missing", "m-1", "m-1"]), now, now, now,
      JSON.stringify(["m-2", "missing", "m-1", "m-1"]), now, now, now, now,
    ],
  );

  const payload = await listTaskGroupsForAnnotator(db, "ann-1", { isSqlite: true });
  assert.equal(payload.taskGroups.length, 1);
  assert.deepEqual(payload.taskGroups[0], {
    id: "run-1",
    assignmentRunId: "run-1",
    datasetId: "ds-1",
    datasetName: "Dataset One",
    metricLabels: ["Second", "First", "First"],
    totalCount: 3,
    submittedCount: 1,
    remainingCount: 2,
    skippedCount: 1,
    status: "in_progress",
    assignedAt: now,
  });
}

main().finally(() => client.close());
