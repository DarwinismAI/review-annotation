import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSource = readFileSync("src/app/api/datasets/route.ts", "utf8");
const newDatasetPageSource = readFileSync("src/app/admin/datasets/new/page.tsx", "utf8");
const datasetClientSources = [
  readFileSync("src/app/admin/datasets/new/page.tsx", "utf8"),
  readFileSync("src/app/admin/datasets/[id]/page.tsx", "utf8"),
  readFileSync("src/app/admin/datasets/[id]/rows/[rowId]/page.tsx", "utf8"),
  readFileSync("src/components/admin/dataset-row-detail-dialog.tsx", "utf8"),
  readFileSync("src/components/admin/dataset-assign-modal.tsx", "utf8"),
  readFileSync("src/components/admin/dataset-append-import-panel.tsx", "utf8"),
].join("\n");

assert.match(routeSource, /searchParams\.get\("summary"\)/);
assert.match(routeSource, /searchParams\.get\("counts"\)/);
assert.doesNotMatch(routeSource, /db\.select\(\)\.from\(datasets\)/);
assert.match(routeSource, /id:\s*datasets\.id/);
assert.match(routeSource, /createdAt:\s*datasets\.createdAt/);
assert.match(newDatasetPageSource, /summary\?\.importingCount/);
assert.match(newDatasetPageSource, /\/api\/datasets\?page=1&pageSize=1&summary=1/);
assert.doesNotMatch(datasetClientSources, /response\.json\(\)/);
assert.doesNotMatch(datasetClientSources, /\.json\(\) as Promise/);
