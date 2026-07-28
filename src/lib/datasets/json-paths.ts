export type JsonRecord = Record<string, unknown>;
export type JsonFieldType = "string" | "number" | "boolean" | "null" | "array" | "object";

export interface JsonFieldDescriptor {
  path: string;
  type: JsonFieldType;
  sample: unknown;
}

export function getJsonValueType(value: unknown): JsonFieldType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";

  const valueType = typeof value;
  if (valueType === "string" || valueType === "number" || valueType === "boolean") {
    return valueType;
  }

  return "object";
}

export function flattenRecordPaths(record: JsonRecord, prefix = ""): JsonFieldDescriptor[] {
  return Object.entries(record).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = flattenRecordPaths(value as JsonRecord, path);
      return nested.length ? nested : [{ path, type: "object" as const, sample: value }];
    }

    return [{ path, type: getJsonValueType(value), sample: value }];
  });
}

export function getPathValue(record: JsonRecord, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[key];
  }, record);
}

export function hasPath(record: JsonRecord, path: string): boolean {
  return getPathValue(record, path) !== undefined;
}

export function projectFields(record: JsonRecord, paths: string[]): Record<string, unknown> {
  return Object.fromEntries(paths.map((path) => [path, getPathValue(record, path)]));
}

export function buildSchemaFingerprint(rows: JsonRecord[]): JsonFieldDescriptor[] {
  const byPath = new Map<string, JsonFieldDescriptor>();

  for (const row of rows.slice(0, 50)) {
    for (const field of flattenRecordPaths(row)) {
      if (!byPath.has(field.path)) {
        byPath.set(field.path, field);
      }
    }
  }

  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}
