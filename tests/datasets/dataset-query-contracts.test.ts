import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const datasetsRoute = readFileSync("src/app/api/datasets/route.ts", "utf8");
const membersRoute = readFileSync("src/app/api/admin/members/route.ts", "utf8");
const rubricsRoute = readFileSync("src/app/api/rubrics/route.ts", "utf8");
const taskGroupsRoute = readFileSync("src/app/api/annotator/task-groups/route.ts", "utf8");
const taskGroupsRead = readFileSync("src/lib/datasets/task-groups-read.ts", "utf8");
const dashboardRoutePath = "src/app/api/admin/dashboard/route.ts";

assert.match(datasetsRoute, /db\.execute\(\s*sql`[\s\S]*page_datasets/i);
assert.match(datasetsRoute, /dataset_total/i);
assert.match(datasetsRoute, /summary_totals/i);
assert.doesNotMatch(datasetsRoute, /Promise\.all\(\[[\s\S]*?db\s*\.select\(\{\s*total:\s*count\(\)\s*\}\)\.from\(datasetRows\)/);
assert.doesNotMatch(datasetsRoute, /rawJson:\s*datasetRows\.rawJson/);

assert.equal(existsSync(dashboardRoutePath), true);
const dashboardRoute = readFileSync(dashboardRoutePath, "utf8");
assert.match(dashboardRoute, /GET\s*=\s*requireAdmin/);
assert.match(dashboardRoute, /db\.execute\(\s*sql`[\s\S]*recent_datasets/i);
assert.match(dashboardRoute, /activeAnnotators/);
assert.match(dashboardRoute, /totals/);
assert.match(dashboardRoute, /readyDatasets/);
assert.match(dashboardRoute, /importingDatasets/);
assert.match(dashboardRoute, /status\s*=\s*'ready'/);
assert.match(dashboardRoute, /status\s*=\s*'importing'/);
assert.match(dashboardRoute, /SUPERADMIN_EMAILS/);
assert.match(dashboardRoute, /not\s+in/i);
assert.doesNotMatch(dashboardRoute, /where p\.role in \('annotator', 'expert'\) and ep\.status = 'active'/);
assert.doesNotMatch(dashboardRoute, /fetch\(/);
assert.doesNotMatch(dashboardRoute, /\/api\/datasets/);
assert.doesNotMatch(dashboardRoute, /\/api\/admin\/members/);

assert.doesNotMatch(membersRoute, /Promise\.all/);
assert.doesNotMatch(membersRoute, /db\.select\(\)\.from\(profiles\)/);
assert.match(membersRoute, /orderBy\(/);

assert.doesNotMatch(rubricsRoute, /Promise\.all/);
assert.doesNotMatch(rubricsRoute, /db\.select\(\)\.from\(rubrics\)/);
assert.match(rubricsRoute, /leftJoin\(rubricCriteria/);

assert.match(taskGroupsRoute, /GET\s*=\s*requireAnnotatorRead\(async \(_req,\s*claims,\s*context\)/);
assert.match(taskGroupsRoute, /context\.timing\.measure\("sql"/);
assert.match(taskGroupsRoute, /listTaskGroupsForAnnotator\(db,\s*claims\.user\.id\)/);
assert.match(taskGroupsRead, /metricLabels/);
assert.match(taskGroupsRead, /jsonb_array_elements_text/);
assert.match(taskGroupsRead, /allMetricIds/);
assert.match(taskGroupsRead, /inArray/);
