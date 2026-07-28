import {
  assertJsonRecord,
  flattenRecordPaths,
  hasPath,
  isJsonlFile,
  parseDatasetRows,
  type JsonRecord,
  type MissingFieldReport,
} from "./import-validation";

function yieldToBrowser() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

export async function parseDatasetFile(file: File): Promise<JsonRecord[]> {
  if (!isJsonlFile(file.name)) {
    return parseDatasetRows(await file.text(), { filename: file.name });
  }

  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  const rows: JsonRecord[] = [];
  let buffer = "";
  let lineNumber = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      lineNumber += 1;
      appendJsonlLine(rows, line, lineNumber);
      if (rows.length > 0 && rows.length % 500 === 0) await yieldToBrowser();
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    lineNumber += 1;
    appendJsonlLine(rows, buffer, lineNumber);
  }

  if (rows.length === 0) throw new Error("Dataset upload is empty");
  return rows;
}

export async function validateAppendRowsResponsive(rows: JsonRecord[], requiredFields: string[]) {
  const missingFields = new Map<string, number[]>();
  for (const field of requiredFields) missingFields.set(field, []);

  for (let index = 0; index < rows.length; index += 1) {
    for (const field of requiredFields) {
      if (!hasPath(rows[index], field)) missingFields.get(field)?.push(index);
    }
    if (index > 0 && index % 500 === 0) await yieldToBrowser();
  }

  const report: MissingFieldReport[] = Array.from(missingFields.entries())
    .map(([path, missingRowIndexes]) => ({ path, missingRowIndexes, missingCount: missingRowIndexes.length }))
    .filter((field) => field.missingCount > 0);

  return { ok: report.length === 0, missingFields: report };
}

export async function collectExtraFieldsResponsive(rows: JsonRecord[], initialFields: Set<string>) {
  const extraFields = new Set<string>();
  for (let index = 0; index < rows.length; index += 1) {
    for (const field of flattenRecordPaths(rows[index])) {
      if (!initialFields.has(field.path)) extraFields.add(field.path);
    }
    if (index > 0 && index % 500 === 0) await yieldToBrowser();
  }
  return Array.from(extraFields);
}

function appendJsonlLine(rows: JsonRecord[], line: string, lineNumber: number) {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    rows.push(assertJsonRecord(JSON.parse(trimmed), `JSONL row ${lineNumber}`));
  } catch (error) {
    if (error instanceof Error && error.message.includes("must be a JSON object")) throw error;
    throw new Error(`Invalid JSONL at line ${lineNumber}`);
  }
}
