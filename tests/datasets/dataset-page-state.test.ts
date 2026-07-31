import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const datasetsPage = readFileSync("src/app/admin/datasets/page.tsx", "utf8");
const dashboardRegion = readFileSync("src/app/admin/dashboard/dashboard-data-region.tsx", "utf8");

assert.match(datasetsPage, /const \[requestedPage, setRequestedPage\] = useState\(1\)/);
assert.match(datasetsPage, /const displayedPage = data\.page/);
assert.match(datasetsPage, /Trang \{displayedPage\} \/ \{totalPages\}/);
assert.match(datasetsPage, /setRequestedPage\(\(current\) => Math\.max\(1, current - 1\)\)/);
assert.match(datasetsPage, /setRequestedPage\(\(current\) => current \+ 1\)/);
assert.doesNotMatch(datasetsPage, /Trang \{page\} \/ \{totalPages\}/);

assert.match(dashboardRegion, /interface AdminDashboardSnapshot/);
assert.match(dashboardRegion, /useFastResource<AdminDashboardSnapshot>\("\/api\/admin\/dashboard"/);
assert.doesNotMatch(dashboardRegion, /useFastResource<DatasetsPayload>\("\/api\/datasets/);
assert.doesNotMatch(dashboardRegion, /useFastResource<MembersPayload>\("\/api\/admin\/members"/);
