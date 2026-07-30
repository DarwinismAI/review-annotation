import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/hooks/use-fast-resource.ts", "utf8");
const detailPage = readFileSync("src/app/admin/datasets/[id]/page.tsx", "utf8");
const rubricForm = readFileSync("src/components/rubric-form.tsx", "utf8");
const newDatasetPage = readFileSync("src/app/admin/datasets/new/page.tsx", "utf8");
const appendPanel = readFileSync("src/components/admin/dataset-append-import-panel.tsx", "utf8");
const assignModal = readFileSync("src/components/admin/dataset-assign-modal.tsx", "utf8");

assert.match(source, /const DEFAULT_TTL_MS\s*=\s*30000/);
assert.match(source, /type FastResourceStatus\s*=\s*"idle"\s*\|\s*"loading"\s*\|\s*"ready"\s*\|\s*"refreshing"\s*\|\s*"error"/);
assert.match(source, /export function invalidateFastResource/);
assert.match(source, /AbortController/);
assert.match(source, /cache\.get\(url\)/);
assert.match(source, /setState\(\(current\)/);

assert.match(detailPage, /readJsonResponse/);
assert.doesNotMatch(detailPage, /response\.json\(\)/);

assert.match(rubricForm, /invalidateFastResource/);
assert.match(rubricForm, /invalidateFastResource\("\/api\/rubrics"\)/);

assert.match(newDatasetPage, /invalidateFastResource/);
assert.match(newDatasetPage, /invalidateFastResource\("\/api\/datasets"\)/);
assert.match(newDatasetPage, /invalidateFastResource\(`\/api\/datasets\/\$\{payload\.datasetId\}`\)/);

assert.match(appendPanel, /invalidateFastResource/);
assert.match(appendPanel, /invalidateFastResource\("\/api\/datasets"\)/);
assert.match(appendPanel, /invalidateFastResource\(`\/api\/datasets\/\$\{datasetId\}`\)/);

assert.match(assignModal, /invalidateFastResource/);
assert.match(assignModal, /invalidateFastResource\("\/api\/annotator\/task-groups"\)/);
