import {
  buildSchemaFingerprint,
  flattenRecordPaths,
  getPathValue,
  hasPath,
  projectFields,
  type JsonFieldDescriptor,
  type JsonRecord,
} from "./json-paths";

export { flattenRecordPaths, getPathValue, projectFields };
export type { JsonFieldDescriptor, JsonRecord };

export interface MissingFieldReport {
  path: string;
  missingRowIndexes: number[];
  missingCount: number;
}

export function parseDatasetRows(rawText: string): JsonRecord[] {
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

  if (!parsed.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
    throw new Error("Dataset rows must be JSON objects");
  }

  return parsed as JsonRecord[];
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
