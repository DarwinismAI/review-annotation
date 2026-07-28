import { createId } from "@paralleldrive/cuid2";
import { index, integer, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { profiles } from "./schema";

export const datasets = pgTable("datasets", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  status: text("status").notNull().default("ready"),
  schemaFingerprint: jsonb("schema_fingerprint").notNull().$type<Array<{ path: string; type: string; sample: unknown }>>(),
  displayConfig: jsonb("display_config").notNull().$type<{ listFields: string[]; detailFields: string[] }>(),
  requiredAppendFields: jsonb("required_append_fields").notNull().$type<string[]>(),
  createdBy: text("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const datasetImports = pgTable("dataset_imports", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  datasetId: text("dataset_id").notNull().references(() => datasets.id, { onDelete: "cascade" }),
  sourceFilename: text("source_filename").notNull(),
  status: text("status").notNull(),
  rowCount: integer("row_count").notNull().default(0),
  missingFieldsReport: jsonb("missing_fields_report").$type<Array<{ path: string; missingRowIndexes: number[]; missingCount: number }>>(),
  createdBy: text("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const datasetRows = pgTable(
  "dataset_rows",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    datasetId: text("dataset_id").notNull().references(() => datasets.id, { onDelete: "cascade" }),
    importId: text("import_id").notNull().references(() => datasetImports.id, { onDelete: "cascade" }),
    internalRowId: integer("internal_row_id").notNull(),
    rawJson: jsonb("raw_json").notNull().$type<Record<string, unknown>>(),
    sourceId: text("source_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("dataset_rows_dataset_internal_row_unique").on(t.datasetId, t.internalRowId),
    index("dataset_rows_dataset_idx").on(t.datasetId),
  ],
);

export const annotationMetrics = pgTable(
  "annotation_metrics",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    datasetId: text("dataset_id").notNull().references(() => datasets.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    scaleJson: jsonb("scale_json").notNull().$type<{ values: string[] }>(),
    required: integer("required").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("annotation_metrics_dataset_key_unique").on(t.datasetId, t.key)],
);

export const annotationAssignmentRuns = pgTable("annotation_assignment_runs", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  datasetId: text("dataset_id").notNull().references(() => datasets.id, { onDelete: "cascade" }),
  targetOverlap: integer("target_overlap").notNull(),
  metricIds: jsonb("metric_ids").notNull().$type<string[]>(),
  scope: text("scope").notNull(),
  createdBy: text("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const annotationAssignments = pgTable(
  "annotation_assignments",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    assignmentRunId: text("assignment_run_id").notNull().references(() => annotationAssignmentRuns.id, { onDelete: "cascade" }),
    datasetId: text("dataset_id").notNull().references(() => datasets.id, { onDelete: "cascade" }),
    rowId: text("row_id").notNull().references(() => datasetRows.id, { onDelete: "cascade" }),
    annotatorId: text("annotator_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    metricIds: jsonb("metric_ids").notNull().$type<string[]>(),
    metricKey: text("metric_key").notNull(),
    targetOverlap: integer("target_overlap").notNull(),
    status: text("status").notNull().default("assigned"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("annotation_assignments_row_annotator_metric_unique").on(t.rowId, t.annotatorId, t.metricKey),
    index("annotation_assignments_dataset_idx").on(t.datasetId),
    index("annotation_assignments_annotator_idx").on(t.annotatorId),
  ],
);

export const annotationResults = pgTable(
  "annotation_results",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    assignmentId: text("assignment_id").notNull().references(() => annotationAssignments.id, { onDelete: "cascade" }),
    rowId: text("row_id").notNull().references(() => datasetRows.id, { onDelete: "cascade" }),
    annotatorId: text("annotator_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    metricId: text("metric_id").notNull().references(() => annotationMetrics.id, { onDelete: "cascade" }),
    value: text("value"),
    note: text("note"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("annotation_results_assignment_metric_unique").on(t.assignmentId, t.metricId),
    index("annotation_results_row_metric_idx").on(t.rowId, t.metricId),
  ],
);
