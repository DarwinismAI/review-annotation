import assert from "node:assert/strict";
import {
  computeRequiredAppendFields,
  flattenRecordPaths,
  getPathValue,
  parseDatasetRows,
  projectFields,
  validateAppendRows,
  validateDisplayFields,
} from "../../src/lib/datasets/import-validation";

const rows = parseDatasetRows(
  JSON.stringify([
    { id: "1", input: "A", label: { decision: "block" }, meta: { policy: "safety" } },
    { id: "2", input: "B", label: { decision: "allow" }, meta: { policy: "compliance" } },
  ]),
);

assert.equal(rows.length, 2);
assert.deepEqual(
  flattenRecordPaths(rows[0])
    .map((field) => field.path)
    .sort(),
  ["id", "input", "label.decision", "meta.policy"],
);
assert.equal(getPathValue(rows[0], "label.decision"), "block");
assert.deepEqual(projectFields(rows[0], ["input", "label.decision"]), {
  input: "A",
  "label.decision": "block",
});
assert.deepEqual(computeRequiredAppendFields(["input"], ["label.decision", "meta.policy"]), [
  "input",
  "label.decision",
  "meta.policy",
]);

assert.deepEqual(validateDisplayFields(rows, ["input"], ["label.decision"]), {
  ok: true,
  missingFields: [],
});

assert.deepEqual(validateAppendRows([{ input: "C", label: { decision: "block" }, extra: true }], ["input", "label.decision"]), {
  ok: true,
  missingFields: [],
});

assert.deepEqual(validateAppendRows([{ input: "C" }, { label: { decision: "block" } }], ["input", "label.decision"]), {
  ok: false,
  missingFields: [
    { path: "input", missingRowIndexes: [1], missingCount: 1 },
    { path: "label.decision", missingRowIndexes: [0], missingCount: 1 },
  ],
});

assert.throws(() => parseDatasetRows("{\"input\":\"not-array\"}"), /JSON array/);
assert.throws(() => parseDatasetRows("[]"), /empty/);
assert.throws(() => parseDatasetRows("{"), /Invalid JSON/);

const jsonlRows = parseDatasetRows(
  [
    JSON.stringify({ id: "jsonl-1", input: "A", label: { decision: "block" } }),
    "",
    JSON.stringify({ id: "jsonl-2", input: "B", label: { decision: "allow" } }),
  ].join("\n"),
  { filename: "sample.jsonl" },
);
assert.equal(jsonlRows.length, 2);
assert.equal(jsonlRows[1].id, "jsonl-2");
assert.throws(
  () => parseDatasetRows(`${JSON.stringify({ input: "ok" })}\n{`, { filename: "bad.jsonl" }),
  /Invalid JSONL at line 2/,
);
