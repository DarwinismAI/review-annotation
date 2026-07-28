import assert from "node:assert/strict";
import { isAdminRole, isAnnotatorRole, normalizeRole } from "../../src/lib/roles";

assert.equal(normalizeRole("expert"), "annotator");
assert.equal(normalizeRole("annotator"), "annotator");
assert.equal(normalizeRole("admin"), "admin");
assert.equal(normalizeRole("superadmin"), "superadmin");
assert.equal(normalizeRole("unknown"), null);

assert.equal(isAdminRole("superadmin"), true);
assert.equal(isAdminRole("admin"), true);
assert.equal(isAdminRole("annotator"), false);

assert.equal(isAnnotatorRole("annotator"), true);
assert.equal(isAnnotatorRole("expert"), true);
assert.equal(isAnnotatorRole("admin"), false);
