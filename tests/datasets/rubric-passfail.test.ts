import assert from "node:assert/strict";
import { defaultPassFailScale, isPassFailScale } from "../../src/lib/rubrics/pass-fail-scale";

assert.deepEqual(defaultPassFailScale().map((item) => item.label), ["Failed", "Pass"]);
assert.equal(isPassFailScale(defaultPassFailScale()), true);

assert.equal(
  isPassFailScale([
    { score: 1, label: "1", description: "Rất thấp" },
    { score: 2, label: "2", description: "Thấp" },
    { score: 3, label: "3", description: "Trung bình" },
  ]),
  false,
);

const mutableCopy = defaultPassFailScale();
mutableCopy[0].label = "Changed";
assert.equal(defaultPassFailScale()[0].label, "Failed");
