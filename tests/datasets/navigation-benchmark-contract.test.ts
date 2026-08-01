import assert from "node:assert/strict";
import { selectServerTimingHeader } from "../../scripts/benchmark-timing";

const standardOnly = new Headers({ "server-timing": "total;dur=12" });
assert.equal(selectServerTimingHeader(standardOnly), "total;dur=12");

const fallbackOnly = new Headers({ "x-app-server-timing": "total;dur=34" });
assert.equal(selectServerTimingHeader(fallbackOnly), "total;dur=34");

const bothPresent = new Headers({
  "server-timing": "total;dur=56",
  "x-app-server-timing": "total;dur=78",
});
assert.equal(selectServerTimingHeader(bothPresent), "total;dur=56");

const neitherPresent = new Headers();
assert.equal(selectServerTimingHeader(neitherPresent), null);
