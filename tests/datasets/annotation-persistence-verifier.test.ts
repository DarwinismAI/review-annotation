import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("scripts/verify-annotation-persistence.ts", "utf8");

assert.doesNotMatch(source, /firstTask\s*=\s*await apiJson<\{\s*task:\s*\{[\s\S]*?rowId:/);
assert.doesNotMatch(source, /firstTask\.task\.rowId/);
assert.match(source, /const submittedAssignment = submittedAssignments\[0\];/);
assert.match(source, /const adjudicationRowId = submittedAssignment\.rowId;/);
assert.match(source, /if \(!adjudicationRowId\) throw new Error\("PERSISTENCE: submitted assignment has no row id"\);/);
