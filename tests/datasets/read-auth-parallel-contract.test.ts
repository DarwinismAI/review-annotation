import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const authMiddleware = readFileSync("src/lib/auth-middleware.ts", "utf8");
const supabaseServer = readFileSync("src/lib/supabase/server.ts", "utf8");
const dashboardRoute = readFileSync("src/app/api/admin/dashboard/route.ts", "utf8");
const datasetsRoute = readFileSync("src/app/api/datasets/route.ts", "utf8");
const membersRoute = readFileSync("src/app/api/admin/members/route.ts", "utf8");
const rubricsRoute = readFileSync("src/app/api/rubrics/route.ts", "utf8");
const taskGroupsRoute = readFileSync("src/app/api/annotator/task-groups/route.ts", "utf8");

assert.match(authMiddleware, /export function requireAdminRead/);
assert.match(authMiddleware, /export function requireAnnotatorRead/);
assert.match(authMiddleware, /ReadOnlyRequest\s*=\s*Omit<NextRequest,\s*"arrayBuffer"[\s\S]*"json"[\s\S]*"text"/);
assert.match(authMiddleware, /req\.method !== "GET"/);
assert.match(authMiddleware, /getVerifiedSessionClaims/);
assert.match(authMiddleware, /getSessionFromClaims/);
assert.match(authMiddleware, /runAuthorizedRead/);
assert.match(authMiddleware, /if \(!isAdminRole\(session\.user\.role\)\)[\s\S]*return errJson\(403/);
assert.match(authMiddleware, /if \(!isAnnotatorRole\(session\.user\.role\)\)[\s\S]*return errJson\(403/);

assert.match(supabaseServer, /export async function getVerifiedSessionClaims/);
assert.match(supabaseServer, /export async function getSessionFromClaims/);
assert.match(supabaseServer, /devRole:\s*cookieRole/);
assert.match(supabaseServer, /claims\.devRole/);
assert.match(supabaseServer, /db\s*\.\s*select\(\{\s*email:\s*profiles\.email[\s\S]*role:\s*profiles\.role/);
assert.match(supabaseServer, /resolveEffectiveRole\(profile\.role,\s*profile\.email\)/);
assert.doesNotMatch(supabaseServer, /app_metadata[\s\S]*role|user_metadata[\s\S]*role/);

assert.match(dashboardRoute, /GET\s*=\s*requireAdminRead/);
assert.match(datasetsRoute, /GET\s*=\s*requireAdminRead/);
assert.match(membersRoute, /GET\s*=\s*requireAdminRead/);
assert.match(rubricsRoute, /GET\s*=\s*requireAdminRead/);
assert.match(taskGroupsRoute, /GET\s*=\s*requireAnnotatorRead/);

assert.match(membersRoute, /await context\.session/);
assert.match(taskGroupsRoute, /metricLabels/);
assert.doesNotMatch(taskGroupsRoute, /const allMetricIds/);
assert.doesNotMatch(taskGroupsRoute, /inArray/);
assert.doesNotMatch(taskGroupsRoute, /await db\.select\(\{ id: annotationMetrics\.id, label: annotationMetrics\.label \}\)/);
