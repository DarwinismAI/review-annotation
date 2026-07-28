import { createId } from "@paralleldrive/cuid2";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { profiles } from "./schema.sqlite";

export const datasets = sqliteTable("datasets", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  status: text("status").notNull().default("ready"),
  schemaFingerprint: text("schema_fingerprint", { mode: "json" }).notNull().$type<Array<{ path: string; type: string; sample: unknown }>>(),
  displayConfig: text("display_config", { mode: "json" }).notNull().$type<{ listFields: string[]; detailFields: string[] }>(),
  requiredAppendFields: text("required_append_fields", { mode: "json" }).notNull().$type<string[]>(),
  createdBy: text("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const datasetImports = sqliteTable("dataset_imports", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  datasetId: text("dataset_id").notNull().references(() => datasets.id, { onDelete: "cascade" }),
  sourceFilename: text("source_filename").notNull(),
  status: text("status").notNull(),
  rowCount: integer("row_count").notNull().default(0),
  missingFieldsReport: text("missing_fields_report", { mode: "json" }).$type<Array<{ path: string; missingRowIndexes: number[]; missingCount: number }>>(),
  createdBy: text("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const datasetRows = sqliteTable(
  "dataset_rows",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    datasetId: text("dataset_id").notNull().references(() => datasets.id, { onDelete: "cascade" }),
    importId: text("import_id").notNull().references(() => datasetImports.id, { onDelete: "cascade" }),
    internalRowId: integer("internal_row_id").notNull(),
    rawJson: text("raw_json", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
    sourceId: text("source_id"),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    uniqueIndex("dataset_rows_dataset_internal_row_unique").on(t.datasetId, t.internalRowId),
    index("dataset_rows_dataset_idx").on(t.datasetId),
  ],
);

export const annotationMetrics = sqliteTable(
  "annotation_metrics",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    datasetId: text("dataset_id").notNull().references(() => datasets.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    scaleJson: text("scale_json", { mode: "json" }).notNull().$type<{ values: string[] }>(),
    required: integer("required", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (t) => [uniqueIndex("annotation_metrics_dataset_key_unique").on(t.datasetId, t.key)],
);

export const annotationAssignmentRuns = sqliteTable("annotation_assignment_runs", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  datasetId: text("dataset_id").notNull().references(() => datasets.id, { onDelete: "cascade" }),
  targetOverlap: integer("target_overlap").notNull(),
  metricIds: text("metric_ids", { mode: "json" }).notNull().$type<string[]>(),
  scope: text("scope").notNull(),
  createdBy: text("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const annotationAssignments = sqliteTable(
  "annotation_assignments",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    assignmentRunId: text("assignment_run_id").notNull().references(() => annotationAssignmentRuns.id, { onDelete: "cascade" }),
    datasetId: text("dataset_id").notNull().references(() => datasets.id, { onDelete: "cascade" }),
    rowId: text("row_id").notNull().references(() => datasetRows.id, { onDelete: "cascade" }),
    annotatorId: text("annotator_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    metricIds: text("metric_ids", { mode: "json" }).notNull().$type<string[]>(),
    metricKey: text("metric_key").notNull(),
    targetOverlap: integer("target_overlap").notNull(),
    status: text("status").notNull().default("assigned"),
    assignedAt: text("assigned_at").notNull().$defaultFn(() => new Date().toISOString()),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    uniqueIndex("annotation_assignments_row_annotator_metric_unique").on(t.rowId, t.annotatorId, t.metricKey),
    index("annotation_assignments_dataset_idx").on(t.datasetId),
    index("annotation_assignments_annotator_idx").on(t.annotatorId),
  ],
);

export const annotationResults = sqliteTable(
  "annotation_results",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    assignmentId: text("assignment_id").notNull().references(() => annotationAssignments.id, { onDelete: "cascade" }),
    rowId: text("row_id").notNull().references(() => datasetRows.id, { onDelete: "cascade" }),
    annotatorId: text("annotator_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    metricId: text("metric_id").notNull().references(() => annotationMetrics.id, { onDelete: "cascade" }),
    value: text("value"),
    note: text("note"),
    status: text("status", { enum: ["draft", "completed"] }).notNull().default("completed"),
    submittedAt: text("submitted_at").notNull().$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    uniqueIndex("annotation_results_assignment_metric_unique").on(t.assignmentId, t.metricId),
    index("annotation_results_row_metric_idx").on(t.rowId, t.metricId),
    index("annotation_results_assignment_status_idx").on(t.assignmentId, t.status),
    index("annotation_results_row_metric_status_idx").on(t.rowId, t.metricId, t.status),
  ],
);
