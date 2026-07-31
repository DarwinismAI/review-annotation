import { writeFile } from "node:fs/promises";
import { expect, test, type APIResponse, type Page, type TestInfo } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@local.dev";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? process.env.E2E_PASSWORD ?? "local-dev-password";
const ACKNOWLEDGEMENT_THRESHOLD_MS = 150;
const WARM_ROUTE_READY_THRESHOLD_MS = 250;
const BLOCKED_DEPLOYMENT_OWNER = "cxzharry-8988s-projects";

interface NavigationTarget {
  label: string;
  heading: string;
  apiPath: string;
  previousHeading?: string;
  routeShellTestId?: string;
}

interface NavigationTiming {
  acknowledgementMs: number;
  routeReadyMs: number;
  apiMs: number;
  serverTiming: Record<string, number>;
}

interface NavigationEvidence {
  cold: Record<string, NavigationTiming>;
  warmed: Record<string, NavigationTiming>;
}

const ADMIN_NAVIGATION_TARGETS: NavigationTarget[] = [
  { label: "Datasets", heading: "Datasets", apiPath: "/api/datasets" },
  { label: "Thành viên", heading: "Thành viên", apiPath: "/api/admin/members" },
  { label: "Rubric", heading: "Quản lý metrics", apiPath: "/api/rubrics" },
  { label: "Tổng quan", heading: "Tổng quan", apiPath: "/api/admin/dashboard", previousHeading: "Quản lý metrics", routeShellTestId: "dashboard-route-shell" },
];

function assertApprovedDevTarget() {
  const targetUrl = process.env.E2E_BASE_URL;
  if (!targetUrl) return;

  const host = new URL(targetUrl).host;
  if (host.includes(BLOCKED_DEPLOYMENT_OWNER)) {
    throw new Error(`Blocked: ${BLOCKED_DEPLOYMENT_OWNER} is not an approved dev deployment for performance smoke.`);
  }
}

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Mật khẩu").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL(/\/admin/);
}

function collectRuntimeErrors(page: Page) {
  const messages: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (text.includes("favicon.ico") || text.includes("Failed to load resource: the server responded with a status of 404")) return;
    messages.push(text);
  });
  page.on("pageerror", (error) => messages.push(error.message));
  return messages;
}

function parseServerTiming(header: string | null): Record<string, number> {
  const timings: Record<string, number> = {};
  if (!header) return timings;
  for (const part of header.split(",")) {
    const [name, ...params] = part.trim().split(";");
    const durParam = params.find((item) => item.trim().startsWith("dur="));
    if (!name || !durParam) continue;
    const value = Number(durParam.trim().slice("dur=".length));
    if (Number.isFinite(value)) timings[name] = value;
  }
  return timings;
}

async function assertApiBackedResponse(response: APIResponse, label: string) {
  expect(response.status(), `${label} API must not 5xx`).toBeLessThan(500);
  expect(response.ok(), `${label} API must return 2xx`).toBe(true);
  expect(response.headers()["content-type"] ?? "", `${label} API must return JSON`).toContain("application/json");
  try {
    await response.json();
  } catch {
    throw new Error(`${label} API must return valid JSON`);
  }
}

async function measureNav(page: Page, target: NavigationTarget): Promise<NavigationTiming> {
  const desktopNav = page.locator("aside nav");
  await expect(desktopNav).toBeVisible();
  const link = desktopNav.getByRole("link", { name: target.label });
  const handle = await link.elementHandle();
  expect(handle).not.toBeNull();

  const acknowledgementPromise = page.evaluate((targetLink) => {
    return new Promise<number>((resolve, reject) => {
      let clickStart = 0;
      const cleanup = () => {
        window.clearTimeout(timeoutId);
        document.removeEventListener("click", onClick, true);
        observer.disconnect();
      };
      const finish = () => {
        cleanup();
        resolve(Math.round(performance.now() - clickStart));
      };
      const onClick = (event: MouseEvent) => {
        if (!(event.target instanceof Node) || !targetLink.contains(event.target)) return;
        clickStart = performance.now();
        if (targetLink.getAttribute("aria-current") === "page") finish();
      };
      const observer = new MutationObserver(() => {
        if (clickStart > 0 && targetLink.getAttribute("aria-current") === "page") finish();
      });
      const timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for optimistic navigation acknowledgement"));
      }, 1_000);

      document.addEventListener("click", onClick, true);
      observer.observe(targetLink, { attributes: true, attributeFilter: ["aria-current"] });
    });
  }, handle);
  const routeReadyPromise = page.evaluate((targetInfo) => {
    return new Promise<number>((resolve, reject) => {
      let clickStart = 0;
      let observer: MutationObserver | null = null;
      const visibleTextMatches = (element: Element, text: string) => {
        const style = window.getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none" && element.textContent?.trim() === text;
      };
      const headingMatches = () =>
        Array.from(document.querySelectorAll("h1,h2,[role='heading']")).some((element) => visibleTextMatches(element, targetInfo.heading));
      const previousHeadingStillVisible = () =>
        targetInfo.previousHeading
          ? Array.from(document.querySelectorAll("h1,h2,[role='heading']")).some((element) => visibleTextMatches(element, targetInfo.previousHeading!))
          : false;
      const routeShellMatches = () =>
        targetInfo.routeShellTestId ? Boolean(document.querySelector(`[data-testid="${targetInfo.routeShellTestId}"]`)) || headingMatches() : headingMatches();
      const routeReady = () => routeShellMatches() && headingMatches() && !previousHeadingStillVisible();
      const cleanup = () => {
        window.clearTimeout(timeoutId);
        document.removeEventListener("click", onClick, true);
        observer?.disconnect();
      };
      const finish = () => {
        cleanup();
        resolve(Math.round(performance.now() - clickStart));
      };
      const onClick = () => {
        clickStart = performance.now();
        if (routeReady()) finish();
      };
      const timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for route content: ${targetInfo.heading}`));
      }, 10_000);

      document.addEventListener("click", onClick, true);
      observer = new MutationObserver(() => {
        if (clickStart > 0 && routeReady()) finish();
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    });
  }, { heading: target.heading, previousHeading: target.previousHeading, routeShellTestId: target.routeShellTestId });

  const apiStarted = performance.now();
  const apiResponsePromise = page.request.get(target.apiPath, {
    headers: {
      accept: "application/json",
      "cache-control": "no-store",
    },
  });
  await link.click();
  const [acknowledgementMs, routeReadyMs, apiResponse] = await Promise.all([acknowledgementPromise, routeReadyPromise, apiResponsePromise]);
  const apiMs = Math.round(performance.now() - apiStarted);
  await assertApiBackedResponse(apiResponse, target.label);
  await expect(page.getByRole("heading", { name: target.heading })).toBeVisible();
  await expect(link).toHaveAttribute("aria-current", "page");
  return {
    acknowledgementMs,
    routeReadyMs,
    apiMs,
    serverTiming: parseServerTiming(apiResponse.headers()["server-timing"] ?? null),
  };
}

async function measureNavigationPass(page: Page) {
  const timings: Record<string, NavigationTiming> = {};
  for (const target of ADMIN_NAVIGATION_TARGETS) {
    timings[target.label] = await measureNav(page, target);
  }
  return timings;
}

test("admin navigation gives quick visible feedback", async ({ page }, testInfo: TestInfo) => {
  assertApprovedDevTarget();
  const runtimeErrors = collectRuntimeErrors(page);
  await loginAsAdmin(page);
  await page.goto("/admin/dashboard");
  await expect(page.getByRole("heading", { name: "Tổng quan" })).toBeVisible();

  const timingEvidence: NavigationEvidence = {
    cold: await measureNavigationPass(page),
    warmed: {},
  };
  await page.goto("/admin/dashboard");
  await expect(page.getByRole("heading", { name: "Tổng quan" })).toBeVisible();
  timingEvidence.warmed = await measureNavigationPass(page);

  const timingEvidenceJson = JSON.stringify(timingEvidence, null, 2);
  await writeFile(testInfo.outputPath("navigation-timings.json"), timingEvidenceJson);

  await testInfo.attach("navigation-timings", {
    body: timingEvidenceJson,
    contentType: "application/json",
  });

  for (const value of Object.values(timingEvidence.warmed)) {
    expect(value.acknowledgementMs).toBeLessThanOrEqual(ACKNOWLEDGEMENT_THRESHOLD_MS);
    expect(value.routeReadyMs).toBeLessThanOrEqual(WARM_ROUTE_READY_THRESHOLD_MS);
    expect(Object.keys(value.serverTiming).sort()).toEqual(expect.arrayContaining(["auth", "profile", "sql", "total"]));
    expect(value.serverTiming.total).toBeLessThanOrEqual(WARM_ROUTE_READY_THRESHOLD_MS);
  }
  expect(runtimeErrors).toEqual([]);
});
