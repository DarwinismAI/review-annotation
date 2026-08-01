import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const vercelConfig = JSON.parse(readFileSync("vercel.json", "utf8"));
const batchesRoute = readFileSync("src/app/api/batches/route.ts", "utf8");

assert.deepEqual(vercelConfig.regions, ["sin1"]);
assert.equal(Object.keys(vercelConfig).sort().join(","), "regions");
assert.match(batchesRoute, /export const maxDuration = 60/);
