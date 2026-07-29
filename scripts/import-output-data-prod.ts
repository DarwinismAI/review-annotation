import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline";
import postgres from "postgres";

type JsonRecord = Record<string, unknown>;

const DEFAULT_FILE = "output_data.jsonl";
const DEFAULT_DATASET_NAME = "Humanity Output Data";
const DEFAULT_DOMAIN = "safety_compliance";
const DEFAULT_CHUNK_SIZE = 500;

const listFields = ["input", "intent", "sub_intent"];
const detailFields = [
  "input",
  "intent",
  "sub_intent",
  "group",
  "severity",
  "definition",
  "match_when",
  "do_not_match",
  "example_match",
  "example_no_match",
  "example_boundary",
];

interface Args {
  chunkSize: number;
  datasetName: string;
  domain: string;
  dryRun: boolean;
  file: string;
}

interface ParsedFile {
  hash: string;
  rows: JsonRecord[];
  schemaFingerprint: Array<{ path: string; type: string; sample: unknown }>;
}

interface RubricMetric {
  key: string;
  label: string;
  description: string | null;
  scale: { values: string[] };
  required: boolean;
  sortOrder: number;
}

interface SourceIdentity {
  datasetId: string;
  importId: string;
  sourceFilename: string;
}

function parseArgs(): Args {
  const args: Args = {
    chunkSize: Number(process.env.IMPORT_CHUNK_SIZE ?? DEFAULT_CHUNK_SIZE),
    datasetName: process.env.DATASET_NAME ?? DEFAULT_DATASET_NAME,
    domain: process.env.DATASET_DOMAIN ?? DEFAULT_DOMAIN,
    dryRun: process.env.DRY_RUN !== "0",
    file: process.env.IMPORT_FILE ?? DEFAULT_FILE,
  };

  for (let index = 2; index < process.argv.length; index++) {
    const flag = process.argv[index];
    const value = process.argv[index + 1];
    if (flag === "--file" && value) {
      args.file = value;
      index++;
    } else if (flag === "--dataset-name" && value) {
      args.datasetName = value;
      index++;
    } else if (flag === "--domain" && value) {
      args.domain = value;
      index++;
    } else if (flag === "--chunk-size" && value) {
      args.chunkSize = Number(value);
      index++;
    } else if (flag === "--dry-run") {
      args.dryRun = true;
    } else if (flag === "--execute") {
      args.dryRun = false;
    }
  }

  if (!Number.isInteger(args.chunkSize) || args.chunkSize < 1 || args.chunkSize > 1000) {
    throw new Error("chunk size must be an integer between 1 and 1000");
  }
  return args;
}

function getPathValue(record: JsonRecord, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as JsonRecord)[key];
  }, record);
}

function hasPath(record: JsonRecord, path: string): boolean {
  return getPathValue(record, path) !== undefined;
}

function valueOrNull(value: unknown): unknown {
  return value === undefined ? null : value;
}

function normalizeRow(row: JsonRecord): JsonRecord {
  return {
    ...row,
    intent: valueOrNull(row.intent ?? getPathValue(row, "label.intent")),
    sub_intent: valueOrNull(row.sub_intent ?? getPathValue(row, "label.sub_intent")),
    group: valueOrNull(row.group ?? getPathValue(row, "label.group")),
    severity: valueOrNull(row.severity ?? getPathValue(row, "label.severity")),
    definition: valueOrNull(row.definition),
    match_when: valueOrNull(row.match_when),
    do_not_match: valueOrNull(row.do_not_match),
    example_match: valueOrNull(row.example_match),
    example_no_match: valueOrNull(row.example_no_match),
    example_boundary: valueOrNull(row.example_boundary),
  };
}

function fieldType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : typeof value;
}

function flattenRecord(record: JsonRecord, prefix = ""): Array<{ path: string; type: string; sample: unknown }> {
  return Object.entries(record).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = flattenRecord(value as JsonRecord, path);
      return nested.length > 0 ? nested : [{ path, type: "object", sample: value }];
    }
    return [{ path, type: fieldType(value), sample: value }];
  });
}

function buildSchemaFingerprint(rows: JsonRecord[]): Array<{ path: string; type: string; sample: unknown }> {
  const fields = new Map<string, { path: string; type: string; sample: unknown }>();
  for (const row of rows.slice(0, 50)) {
    for (const field of flattenRecord(row)) {
      if (!fields.has(field.path)) fields.set(field.path, field);
    }
  }
  return [...fields.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function assertJsonRecord(value: unknown, lineNumber: number): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`line ${lineNumber} must be a JSON object`);
  }
  return value as JsonRecord;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolvePromise);
  });
  return hash.digest("hex");
}

async function parseJsonl(path: string): Promise<ParsedFile> {
  const rows: JsonRecord[] = [];
  const hash = await sha256File(path);
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let lineNumber = 0;

  for await (const line of rl) {
    lineNumber++;
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(`invalid JSONL at line ${lineNumber}`);
    }
    const row = normalizeRow(assertJsonRecord(parsed, lineNumber));
    for (const field of listFields) {
      if (!hasPath(row, field)) throw new Error(`line ${lineNumber} missing required field ${field}`);
    }
    for (const field of detailFields) {
      if (!hasPath(row, field)) throw new Error(`line ${lineNumber} missing normalized detail field ${field}`);
    }
    rows.push(row);
  }

  if (rows.length === 0) throw new Error("JSONL file is empty");
  return { hash, rows, schemaFingerprint: buildSchemaFingerprint(rows) };
}

function sourceId(row: JsonRecord): string | null {
  const id = row.id ?? row._id ?? row.uuid;
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

function idFromSource(sourceName: string, hash: string, prefix: string): string {
  return `${prefix}_${createHash("sha256").update(sourceName).update("\0").update(hash).digest("hex").slice(0, 24)}`;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

function scaleLabels(rawScale: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawScale);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return "";
      const label = (item as { label?: unknown }).label;
      return typeof label === "string" ? label.trim() : "";
    })
    .filter(Boolean);
}

function metricId(datasetId: string, key: string): string {
  return `${datasetId}_metric_${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
}

function validateRubricMetrics(metrics: RubricMetric[], domain: string): RubricMetric[] {
  if (metrics.length === 0) throw new Error(`no rubric metrics found for domain ${domain}`);
  const invalidMetric = metrics.find((metric: RubricMetric) => {
    const values = metric.scale.values;
    return values.length !== 2 || values[0] !== "Failed" || values[1] !== "Pass";
  });
  if (invalidMetric) throw new Error(`rubric metric ${invalidMetric.key} must use Failed/Pass scale`);
  return metrics;
}

function getDatabaseUrl(): string | undefined {
  return cleanEnvValue(process.env.DATABASE_URL ?? process.env.POSTGRES_URL);
}

function requireDatabaseUrl(action: string): string {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) throw new Error(`DATABASE_URL or POSTGRES_URL is required to ${action}`);
  return databaseUrl;
}

function cleanEnvValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function sourceIdentity(sourceName: string, hash: string): SourceIdentity {
  const datasetId = idFromSource(sourceName, hash, "prod_output_dataset");
  const importId = idFromSource(sourceName, hash, "prod_output_import");
  return { datasetId, importId, sourceFilename: `${sourceName}#sha256=${hash}` };
}

function requiredAppendFields(): string[] {
  return [...new Set([...listFields, ...detailFields])];
}

async function loadRubricMetricsPostgres(sql: any, domain: string): Promise<RubricMetric[]> {
  const rows = await sql`
    select
      rc.id as criterion_id,
      r.name as rubric_name,
      rc.name as criterion_name,
      rc.description,
      rc.scale,
      rc.required
    from rubrics r
    inner join rubric_criteria rc on rc.rubric_id = r.id
    where r.domain = ${domain}
    order by r.created_at asc, r.id asc, rc.sort_order asc
  `;

  const metrics = rows.map((row: any, index: number): RubricMetric => ({
    key: String(row.criterion_id),
    label: String(row.rubric_name || row.criterion_name || row.criterion_id),
    description: row.description ?? null,
    scale: { values: scaleLabels(String(row.scale ?? "")) },
    required: Boolean(row.required),
    sortOrder: index,
  }));

  return validateRubricMetrics(metrics, domain);
}

async function importRows(args: Args, parsed: ParsedFile, sourceName: string) {
  const databaseUrl = requireDatabaseUrl("execute the production import");
  if (process.env.ALLOW_PROD_DATASET_IMPORT !== "1") {
    throw new Error("set ALLOW_PROD_DATASET_IMPORT=1 to execute the production import");
  }

  const sql = postgres(databaseUrl, { prepare: false });
  const { datasetId, importId, sourceFilename } = sourceIdentity(sourceName, parsed.hash);
  const now = new Date();

  try {
    await sql.begin(async (tx) => {
      const metrics = await loadRubricMetricsPostgres(tx, args.domain);
      const existing = await tx`
        select d.id, d.name, i.status, i.row_count
        from dataset_imports i
        inner join datasets d on d.id = i.dataset_id
        where i.id = ${importId} or i.source_filename = ${sourceFilename}
        limit 1
      `;
      if (existing.length > 0) {
        const row = existing[0] as { id: string; name: string; status: string; row_count: number };
        if (row.status === "completed" && Number(row.row_count) === parsed.rows.length) {
          console.log(`IMPORT_SKIPPED existing dataset=${row.id} name="${row.name}" rows=${row.row_count}`);
          return;
        }
        throw new Error(`source already exists but is incomplete: dataset=${row.id} status=${row.status} rows=${row.row_count}`);
      }

      const activeImports = await tx`
        select d.id, d.name, i.id as import_id
        from datasets d
        inner join dataset_imports i on i.dataset_id = d.id
        where d.domain = ${args.domain}
          and d.status = 'importing'
          and i.status = 'in_progress'
        limit 1
      `;
      if (activeImports.length > 0) {
        const active = activeImports[0] as { id: string; name: string; import_id: string };
        throw new Error(`active import exists for domain ${args.domain}: dataset=${active.id} import=${active.import_id} name="${active.name}"`);
      }

      await tx`
        insert into datasets
          (id, name, domain, status, schema_fingerprint, display_config, required_append_fields, created_by, created_at, updated_at)
        values
          (
            ${datasetId},
            ${args.datasetName},
            ${args.domain},
            'importing',
            ${JSON.stringify(parsed.schemaFingerprint)},
            ${JSON.stringify({ listFields, detailFields })},
            ${JSON.stringify(requiredAppendFields())},
            null,
            ${now},
            ${now}
          )
      `;
      await tx`
        insert into dataset_imports
          (id, dataset_id, source_filename, status, row_count, missing_fields_report, created_by, created_at)
        values (${importId}, ${datasetId}, ${sourceFilename}, 'in_progress', 0, null, null, ${now})
      `;
      await tx`
        insert into annotation_metrics ${tx(
          metrics.map((metric) => ({
            id: metricId(datasetId, metric.key),
            dataset_id: datasetId,
            key: metric.key,
            label: metric.label,
            description: metric.description,
            scale_json: JSON.stringify(metric.scale),
            required: metric.required ? 1 : 0,
            sort_order: metric.sortOrder,
            created_at: now,
            updated_at: now,
          })),
          "id",
          "dataset_id",
          "key",
          "label",
          "description",
          "scale_json",
          "required",
          "sort_order",
          "created_at",
          "updated_at",
        )}
      `;
      console.log(`METRIC_COUNT=${metrics.length}`);

      let inserted = 0;
      for (const [chunkIndex, chunk] of chunks(parsed.rows, args.chunkSize).entries()) {
        const rowValues = chunk.map((row, index) => ({
          id: `${datasetId}_row_${inserted + index + 1}`,
          dataset_id: datasetId,
          import_id: importId,
          internal_row_id: inserted + index + 1,
          raw_json: JSON.stringify(row),
          source_id: sourceId(row),
          created_at: now,
        }));
        await tx`
          insert into dataset_rows ${tx(
            rowValues,
            "id",
            "dataset_id",
            "import_id",
            "internal_row_id",
            "raw_json",
            "source_id",
            "created_at",
          )}
        `;
        inserted += chunk.length;
        console.log(`IMPORT_PROGRESS chunk=${chunkIndex + 1} inserted=${inserted}/${parsed.rows.length}`);
      }

      await tx`update dataset_imports set status = 'completed', row_count = ${inserted} where id = ${importId}`;
      await tx`update datasets set status = 'ready', updated_at = ${now} where id = ${datasetId}`;
      console.log(`IMPORT_DONE dataset=${datasetId} import=${importId} rows=${inserted}`);
    });
  } finally {
    await sql.end();
  }
}

async function dryRunMetricCount(domain: string): Promise<string> {
  const databaseUrl = requireDatabaseUrl("verify rubric metric count");
  const sql = postgres(databaseUrl, { prepare: false });
  try {
    const metrics = await loadRubricMetricsPostgres(sql, domain);
    return String(metrics.length);
  } finally {
    await sql.end();
  }
}

async function main() {
  const args = parseArgs();
  const filePath = resolve(args.file);
  const sourceName = basename(filePath);
  const parsed = await parseJsonl(filePath);
  const missingDetailFields = detailFields.filter((field) => !parsed.schemaFingerprint.some((item) => item.path === field));

  console.log(`DRY_RUN=${args.dryRun ? "1" : "0"}`);
  console.log(`SOURCE_NAME=${sourceName}`);
  console.log(`SOURCE_SHA256=${parsed.hash}`);
  console.log(`ROW_COUNT=${parsed.rows.length}`);
  console.log(`LIST_FIELDS=${listFields.join(",")}`);
  console.log(`DETAIL_FIELDS=${detailFields.join(",")}`);
  if (args.dryRun) {
    console.log(`METRIC_COUNT=${await dryRunMetricCount(args.domain)}`);
  }
  if (missingDetailFields.length > 0) {
    console.log(`DETAIL_FIELDS_NOT_IN_SOURCE=${missingDetailFields.join(",")}`);
  }

  if (args.dryRun) return;
  await importRows(args, parsed, sourceName);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
