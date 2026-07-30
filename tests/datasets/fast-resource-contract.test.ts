import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/hooks/use-fast-resource.ts", "utf8");
const detailPage = readFileSync("src/app/admin/datasets/[id]/page.tsx", "utf8");

assert.match(source, /const DEFAULT_TTL_MS\s*=\s*30000/);
assert.match(source, /type FastResourceStatus\s*=\s*"idle"\s*\|\s*"loading"\s*\|\s*"ready"\s*\|\s*"refreshing"\s*\|\s*"error"/);
assert.match(source, /export function invalidateFastResource/);
assert.match(source, /AbortController/);
assert.match(source, /cache\.get\(url\)/);
assert.match(source, /setState\(\(current\)/);

assert.match(detailPage, /readJsonResponse/);
assert.doesNotMatch(detailPage, /response\.json\(\)/);
