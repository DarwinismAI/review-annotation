import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const source = readFileSync("src/hooks/use-fast-resource.ts", "utf8");
const detailPage = readFileSync("src/app/admin/datasets/[id]/page.tsx", "utf8");
const rubricForm = readFileSync("src/components/rubric-form.tsx", "utf8");
const newDatasetPage = readFileSync("src/app/admin/datasets/new/page.tsx", "utf8");
const appendPanel = readFileSync("src/components/admin/dataset-append-import-panel.tsx", "utf8");
const assignModal = readFileSync("src/components/admin/dataset-assign-modal.tsx", "utf8");
const dashboardPage = readFileSync("src/app/admin/dashboard/page.tsx", "utf8");
const dashboardDataRegion = readFileSync("src/app/admin/dashboard/dashboard-data-region.tsx", "utf8");
const dashboardLoadingPath = "src/app/admin/dashboard/loading.tsx";
assert.ok(existsSync(dashboardLoadingPath), "Dashboard route loading boundary must exist");
const dashboardLoading = readFileSync(dashboardLoadingPath, "utf8");
const appNavigation = readFileSync("src/components/app-navigation.tsx", "utf8");

assert.match(source, /const DEFAULT_TTL_MS\s*=\s*30000/);
assert.match(source, /type FastResourceStatus\s*=\s*"idle"\s*\|\s*"loading"\s*\|\s*"ready"\s*\|\s*"refreshing"\s*\|\s*"error"/);
assert.match(source, /export function invalidateFastResource/);
assert.match(source, /AbortController/);
assert.match(source, /fastResourceKey\(currentSessionId,\s*url\)/);
assert.match(source, /cache\.get\(key\)/);
assert.match(source, /cache\.get\(sessionKey\)/);
assert.doesNotMatch(source, /cache\.get\(url\)/);
assert.doesNotMatch(source, /cache\.set\(url,/);
assert.match(source, /setState\(\(current\)/);

assert.match(detailPage, /readJsonResponse/);
assert.doesNotMatch(detailPage, /response\.json\(\)/);

assert.match(rubricForm, /invalidateFastResource/);
assert.match(rubricForm, /invalidateFastResource\("\/api\/rubrics"\)/);

assert.match(newDatasetPage, /invalidateFastResource/);
assert.match(newDatasetPage, /invalidateFastResource\("\/api\/datasets"\)/);
assert.match(newDatasetPage, /invalidateFastResource\(`\/api\/datasets\/\$\{payload\.datasetId\}`\)/);

assert.match(appendPanel, /invalidateFastResource/);
assert.match(appendPanel, /invalidateFastResource\("\/api\/datasets"\)/);
assert.match(appendPanel, /invalidateFastResource\(`\/api\/datasets\/\$\{datasetId\}`\)/);

assert.match(assignModal, /invalidateFastResource/);
assert.match(assignModal, /invalidateFastResource\("\/api\/annotator\/task-groups"\)/);

assert.doesNotMatch(dashboardPage, /^"use client";/);
assert.match(dashboardPage, /import \{ DashboardDataRegion \} from "\.\/dashboard-data-region";/);
assert.match(dashboardPage, /<h1 className="text-2xl font-semibold text-slate-900">Tổng quan<\/h1>/);
assert.match(dashboardPage, /<DashboardDataRegion \/>/);
assert.doesNotMatch(dashboardPage, /useFastResource|useMemo|\/api\/datasets|\/api\/admin\/members/);

assert.match(dashboardDataRegion, /^"use client";/);
assert.match(dashboardDataRegion, /useFastResource<AdminDashboardSnapshot>\("\/api\/admin\/dashboard"/);
assert.doesNotMatch(dashboardDataRegion, /useFastResource<DatasetsPayload>/);
assert.doesNotMatch(dashboardDataRegion, /useFastResource<MembersPayload>/);
assert.match(dashboardDataRegion, /dashboardResource\.isInitialLoading/);
assert.match(dashboardDataRegion, /dashboardResource\.isRefreshing/);
assert.match(dashboardDataRegion, /Đang cập nhật/);
assert.match(dashboardDataRegion, /error/);
assert.doesNotMatch(dashboardDataRegion, /localStorage|document\.|<script|dangerouslySetInnerHTML/);

assert.match(dashboardLoading, /export default function/);
assert.match(dashboardLoading, /data-testid="dashboard-route-shell"/);
assert.match(dashboardLoading, /data-testid="dashboard-loading-shell"/);
assert.match(dashboardLoading, /<h1 className="text-2xl font-semibold text-slate-900">Tổng quan<\/h1>/);
assert.match(dashboardLoading, /Theo dõi nhanh dữ liệu, metric và annotator đang hoạt động\./);
assert.match(dashboardLoading, /animate-pulse|Skeleton/);
assert.doesNotMatch(dashboardLoading, /rounded-xl/);
assert.doesNotMatch(dashboardLoading, /DashboardDataRegion|useFastResource|fetch\(|localStorage|document\.|dangerouslySetInnerHTML/);
assert.doesNotMatch(dashboardLoading, /toLocaleString|Dataset gần đây|Humanity Output Data|24\.495|24495|\\bready\\b/);

assert.match(appNavigation, /\{\s*href:\s*"\/admin\/dashboard",\s*label:\s*"Tổng quan"/);
assert.match(appNavigation, /prefetch=\{href === "\/admin\/dashboard" \? true : undefined\}/);
assert.match(appNavigation, /onFocus=\{\(\) => router\.prefetch\(href\)\}/);
assert.match(appNavigation, /onMouseEnter=\{\(\) => router\.prefetch\(href\)\}/);
assert.doesNotMatch(appNavigation, /setInterval|setTimeout|(^|[^\w.])fetch\(/);
