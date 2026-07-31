import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildAdminRowHref,
  confirmDirtyNavigation,
  isTextInputTarget,
} from "../../src/lib/datasets/admin-row-navigation";

const rowPage = readFileSync("src/app/admin/datasets/[id]/rows/[rowId]/page.tsx", "utf8");
const panel = readFileSync("src/components/admin/adjudication-panel.tsx", "utf8");

assert.equal(
  buildAdminRowHref({
    datasetId: "dataset-1",
    rowId: "row-2",
    from: "page=3&q=policy&completion=incomplete",
    search: "policy",
    completion: "incomplete",
  }),
  "/admin/datasets/dataset-1/rows/row-2?from=page%3D3%26q%3Dpolicy%26completion%3Dincomplete&search=policy&completion=incomplete",
);

assert.equal(confirmDirtyNavigation(false, () => false), true);
assert.equal(confirmDirtyNavigation(true, () => true), true);
assert.equal(confirmDirtyNavigation(true, () => false), false);
assert.equal(isTextInputTarget({ tagName: "TEXTAREA" }), true);
assert.equal(isTextInputTarget({ tagName: "INPUT", type: "text" }), true);
assert.equal(isTextInputTarget({ tagName: "INPUT", type: "checkbox" }), false);
assert.equal(isTextInputTarget({ tagName: "DIV", isContentEditable: true }), true);
assert.equal(isTextInputTarget({ tagName: "BUTTON" }), false);

assert.match(rowPage, /useRouter\(\)/);
assert.match(rowPage, /loadIdRef/);
assert.match(rowPage, /setRow\(null\)/);
assert.match(rowPage, /setNavigation\(null\)/);
assert.match(rowPage, /rowPayload\.row\.id !== rowId/);
assert.match(rowPage, /!row \|\| row\.id !== rowId \|\| !navigation/);
assert.match(rowPage, /navigation: RowNavigation/);
assert.match(rowPage, /adjudications\?:/);
assert.match(rowPage, /router\.prefetch/);
assert.match(rowPage, /beforeunload/);
assert.match(rowPage, /Alt\+Left/);
assert.match(rowPage, /Alt\+Right/);
assert.match(rowPage, /ChevronLeft/);
assert.match(rowPage, /ChevronRight/);
assert.match(rowPage, /skipDirtyConfirm/);
assert.match(rowPage, /goToRow\(navigation\.nextRowId, \{ skipDirtyConfirm: true \}\)/);
assert.match(rowPage, /title="Câu trước \(Alt\+Left\)"/);
assert.match(rowPage, /title="Câu tiếp \(Alt\+Right\)"/);
assert.doesNotMatch(rowPage, /Promise\.all\(\[[\s\S]*?adjudicationResponse/);
assert.doesNotMatch(rowPage, /\/adjudication`, \{ cache: "no-store" \}/);

assert.match(panel, /onDirtyChange\?: \(dirty: boolean\) => void/);
assert.match(panel, /onSaved\?: \(result: PersistedAdjudication\[\]\) => void/);
assert.match(panel, /onSaveAndNext\?: \(result: PersistedAdjudication\[\]\) => void/);
assert.match(panel, /hasNext: boolean/);
assert.match(panel, /Lưu & câu tiếp/);
assert.match(panel, /onDirtyChange\?\.\(false\)/);
