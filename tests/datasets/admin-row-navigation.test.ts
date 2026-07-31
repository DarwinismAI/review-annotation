import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildCompletionPredicate,
  isRowComplete,
  normalizeDatasetRowFilters,
  type RowProgressCounts,
} from "../../src/lib/datasets/admin-row-query";

assert.deepEqual(normalizeDatasetRowFilters(new URLSearchParams("q= Policy &completion=completed")), {
  search: "policy",
  completion: "complete",
});
assert.deepEqual(normalizeDatasetRowFilters(new URLSearchParams("search=Safety&completion=incomplete")), {
  search: "safety",
  completion: "incomplete",
});
assert.deepEqual(normalizeDatasetRowFilters(new URLSearchParams("completion=unknown")), {
  search: "",
  completion: "all",
});

const completeRow: RowProgressCounts = { completedCount: 2, targetOverlap: 2 };
const incompleteRow: RowProgressCounts = { completedCount: 1, targetOverlap: 2 };
assert.equal(isRowComplete(completeRow), true);
assert.equal(isRowComplete({ completedCount: 0, targetOverlap: 0 }), false);
assert.equal(isRowComplete(incompleteRow), false);
assert.equal(buildCompletionPredicate("complete").includes("completed_count >= target_overlap"), true);
assert.equal(buildCompletionPredicate("incomplete").includes("completed_count < target_overlap"), true);

const rowListRoute = readFileSync("src/app/api/datasets/[id]/rows/route.ts", "utf8");
assert.match(rowListRoute, /normalizeDatasetRowFilters/);
assert.match(rowListRoute, /filtered_rows/i);
assert.match(rowListRoute, /count\(\*\)\s+over\s*\(\)/i);
assert.match(rowListRoute, /LIMIT\s+\$\{pageSize\}\s+OFFSET\s+\$\{offset\}/i);
assert.doesNotMatch(rowListRoute, /\.filter\(\(row\)/);
assert.match(rowListRoute, /completionPredicate/);

const rowDetailRoute = readFileSync("src/app/api/datasets/[id]/rows/[rowId]/route.ts", "utf8");
assert.match(rowDetailRoute, /normalizeDatasetRowFilters/);
assert.match(rowDetailRoute, /filtered_rows/i);
assert.match(rowDetailRoute, /navigation/);
assert.match(rowDetailRoute, /previousRowId/);
assert.match(rowDetailRoute, /nextRowId/);
assert.match(rowDetailRoute, /filteredTotal/);
assert.match(rowDetailRoute, /annotationAdjudications/);
assert.doesNotMatch(rowDetailRoute, /fetch\(/);
