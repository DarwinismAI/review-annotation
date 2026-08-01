import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const benchmarkSource = readFileSync("scripts/benchmark-navigation-performance.ts", "utf8");

assert.match(benchmarkSource, /APP_SERVER_TIMING_HEADER/);
assert.match(benchmarkSource, /response\.headers\.get\("server-timing"\)/);
assert.match(benchmarkSource, /response\.headers\.get\(APP_SERVER_TIMING_HEADER\)/);
assert.match(benchmarkSource, /parseServerTiming\(response\.headers\.get\("server-timing"\) \?\? response\.headers\.get\(APP_SERVER_TIMING_HEADER\)\)/);
assert.doesNotMatch(benchmarkSource, /serverTimingSource/);
