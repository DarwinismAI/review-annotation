import assert from "node:assert/strict";
import { isAdminRole, isAnnotatorRole, normalizeRole, resolveEffectiveRole } from "../../src/lib/roles";

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

const previousSuperAdmins = process.env.SUPERADMIN_EMAILS;
process.env.SUPERADMIN_EMAILS = "owner@example.com, ops@example.com";
assert.equal(resolveEffectiveRole("admin", "owner@example.com"), "superadmin");
assert.equal(resolveEffectiveRole("expert", "member@example.com"), "annotator");
if (previousSuperAdmins === undefined) {
  delete process.env.SUPERADMIN_EMAILS;
} else {
  process.env.SUPERADMIN_EMAILS = previousSuperAdmins;
}
