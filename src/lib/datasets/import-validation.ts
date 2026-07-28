import {
  buildSchemaFingerprint,
  flattenRecordPaths,
  getPathValue,
  hasPath,
  projectFields,
  type JsonFieldDescriptor,
  type JsonRecord,
} from "./json-paths";

export { flattenRecordPaths, getPathValue, hasPath, projectFields };
export type { JsonFieldDescriptor, JsonRecord };

export interface MissingFieldReport {
  path: string;
  missingRowIndexes: number[];
  missingCount: number;
}

export interface ParseDatasetRowsOptions {
  filename?: string;
}

export function isJsonlFile(filename?: string): boolean {
  return /\.(jsonl|ndjson)$/i.test(filename ?? "");
}

export function assertJsonRecord(value: unknown, rowLabel: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${rowLabel} must be a JSON object`);
  }
  return value as JsonRecord;
}

function parseJsonlRows(rawText: string): JsonRecord[] {
  const rows: JsonRecord[] = [];
  const lines = rawText.split(/\r?\n/);

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      rows.push(assertJsonRecord(JSON.parse(trimmed), `JSONL row ${index + 1}`));
    } catch (error) {
      if (error instanceof Error && error.message.includes("must be a JSON object")) {
        throw error;
      }
      throw new Error(`Invalid JSONL at line ${index + 1}`);
    }
  });

  if (rows.length === 0) {
    throw new Error("Dataset upload is empty");
  }

  return rows;
}

export function parseDatasetRows(rawText: string, options: ParseDatasetRowsOptions = {}): JsonRecord[] {
  if (isJsonlFile(options.filename)) {
    return parseJsonlRows(rawText);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("Invalid JSON");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Dataset upload must be a JSON array");
  }

  if (parsed.length === 0) {
    throw new Error("Dataset upload is empty");
  }

  return parsed.map((row, index) => assertJsonRecord(row, `Dataset row ${index + 1}`));
}

export function inspectDatasetRows(rows: JsonRecord[]) {
  return {
    rowCount: rows.length,
    fields: buildSchemaFingerprint(rows),
    sampleRows: rows.slice(0, 5),
  };
}

export function computeRequiredAppendFields(listFields: string[], detailFields: string[]): string[] {
  return Array.from(new Set([...listFields, ...detailFields]));
}

export function validateDisplayFields(rows: JsonRecord[], listFields: string[], detailFields: string[]) {
  return validateAppendRows(rows, computeRequiredAppendFields(listFields, detailFields));
}

export function validateAppendRows(rows: JsonRecord[], requiredFields: string[]) {
  const missingFields: MissingFieldReport[] = requiredFields
    .map((path) => {
      const missingRowIndexes = rows.flatMap((row, index) => (hasPath(row, path) ? [] : [index]));
      return { path, missingRowIndexes, missingCount: missingRowIndexes.length };
    })
    .filter((field) => field.missingCount > 0);

  return { ok: missingFields.length === 0, missingFields };
}
