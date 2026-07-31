import assert from "node:assert/strict";
import { createRequestTiming } from "../../src/lib/request-timing";

async function main() {
  const marks = [100, 108, 116, 116, 133, 133, 149, 160];
  const timing = createRequestTiming(() => {
    const next = marks.shift();
    if (next === undefined) throw new Error("unexpected clock read");
    return next;
  });

  await timing.measure("auth", async () => "ok");
  await timing.measure("profile", async () => undefined);
  await timing.measure("sql", async () => 1);

  const header = timing.header();
  assert.match(header, /^auth;dur=\d+(\.\d+)?, profile;dur=\d+(\.\d+)?, sql;dur=\d+(\.\d+)?, total;dur=\d+(\.\d+)?$/);
  assert.match(header, /auth;dur=8/);
  assert.match(header, /profile;dur=17/);
  assert.match(header, /sql;dur=16/);
  assert.match(header, /total;dur=60/);
  assert.doesNotMatch(header, /desc=|user|email|token|cookie|authorization|sql=/i);

  const phaseNames = header.split(",").map((part) => part.trim().split(";")[0]);
  assert.deepEqual(phaseNames, ["auth", "profile", "sql", "total"]);
  for (const value of header.matchAll(/dur=([0-9.]+)/g)) {
    assert.ok(Number(value[1]) >= 0);
  }
}

main();
