import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const datasets = readFileSync("src/app/api/datasets/route.ts", "utf8");
const taskGroups = readFileSync("src/app/api/annotator/task-groups/route.ts", "utf8");
const annotatorTasks = readFileSync("src/app/api/annotator/tasks/route.ts", "utf8");
const datasetRows = readFileSync("src/app/api/datasets/[id]/rows/route.ts", "utf8");
const rubrics = readFileSync("src/app/api/rubrics/route.ts", "utf8");
const members = readFileSync("src/app/api/admin/members/route.ts", "utf8");

assert.doesNotMatch(datasets, /db\.select\(\)\.from\(datasets\)/);
assert.match(datasets, /pageSize/);
assert.match(datasets, /summary/);

assert.doesNotMatch(taskGroups, /buildTaskGroups/);
assert.match(taskGroups, /\.groupBy\(/);
assert.match(taskGroups, /totalCount/);
assert.doesNotMatch(taskGroups, /rowId:\s*annotationAssignments\.rowId/);

assert.doesNotMatch(annotatorTasks, /rawJson:\s*datasetRows\.rawJson/);
assert.match(annotatorTasks, /listFields:\s*\{\}/);
assert.match(annotatorTasks, /pageSize/);

assert.match(datasetRows, /fields.*list|listFields/);
assert.match(datasetRows, /id:\s*datasets\.id/);
assert.match(datasetRows, /displayConfig:\s*datasets\.displayConfig/);
assert.doesNotMatch(datasetRows, /db\.select\(\)\.from\(datasets\)/);

assert.doesNotMatch(rubrics, /db\.select\(\)\.from\(rubrics\)/);
assert.doesNotMatch(rubrics, /Promise\.all/);
assert.match(rubrics, /criterionId:\s*rubricCriteria\.id/);

assert.doesNotMatch(members, /db\.select\(\)\.from\(profiles\)/);
assert.match(members, /id:\s*profiles\.id/);
