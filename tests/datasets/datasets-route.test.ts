import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSource = readFileSync("src/app/api/datasets/route.ts", "utf8");
const newDatasetPageSource = readFileSync("src/app/admin/datasets/new/page.tsx", "utf8");

assert.match(routeSource, /searchParams\.get\("summary"\)/);
assert.match(routeSource, /searchParams\.get\("counts"\)/);
assert.doesNotMatch(routeSource, /db\.select\(\)\.from\(datasets\)/);
assert.match(routeSource, /id:\s*datasets\.id/);
assert.match(routeSource, /createdAt:\s*datasets\.createdAt/);
assert.match(newDatasetPageSource, /summary\?\.importingCount/);
assert.match(newDatasetPageSource, /\/api\/datasets\?page=1&pageSize=1&summary=1/);
