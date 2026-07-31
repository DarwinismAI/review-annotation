import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const datasetsPage = readFileSync("src/app/admin/datasets/page.tsx", "utf8");
const dashboardRegion = readFileSync("src/app/admin/dashboard/dashboard-data-region.tsx", "utf8");
const fastResource = readFileSync("src/hooks/use-fast-resource.ts", "utf8");

assert.match(datasetsPage, /const \[requestedPage, setRequestedPage\] = useState\(1\)/);
assert.match(datasetsPage, /const displayedPage = data\.page/);
assert.match(datasetsPage, /Trang \{displayedPage\} \/ \{totalPages\}/);
assert.match(datasetsPage, /setRequestedPage\(\(current\) => Math\.max\(1, current - 1\)\)/);
assert.match(datasetsPage, /setRequestedPage\(\(current\) => current \+ 1\)/);
assert.match(datasetsPage, /disabled=\{displayedPage <= 1 \|\| isRefreshing\}/);
assert.match(datasetsPage, /disabled=\{displayedPage >= totalPages \|\| isRefreshing\}/);
assert.match(datasetsPage, /isRefreshing && datasets\.length > 0/);
assert.doesNotMatch(datasetsPage, /Trang \{page\} \/ \{totalPages\}/);

assert.match(fastResource, /status: initializedRef\.current \? "refreshing" : "loading"/);
assert.doesNotMatch(fastResource, /initializedRef\.current && sameUrl \? "refreshing" : "loading"/);

assert.match(dashboardRegion, /interface AdminDashboardSnapshot/);
assert.match(dashboardRegion, /useFastResource<AdminDashboardSnapshot>\("\/api\/admin\/dashboard"/);
assert.doesNotMatch(dashboardRegion, /useFastResource<DatasetsPayload>\("\/api\/datasets/);
assert.doesNotMatch(dashboardRegion, /useFastResource<MembersPayload>\("\/api\/admin\/members"/);
