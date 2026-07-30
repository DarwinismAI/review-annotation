import { writeFile } from "node:fs/promises";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@local.dev";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? process.env.E2E_PASSWORD ?? "local-dev-password";
const ACKNOWLEDGEMENT_THRESHOLD_MS = 150;
const WARM_ROUTE_READY_THRESHOLD_MS = 250;
const BLOCKED_DEPLOYMENT_OWNER = "cxzharry-8988s-projects";

interface NavigationTarget {
  label: string;
  heading: string;
}

interface NavigationTiming {
  acknowledgementMs: number;
  routeReadyMs: number;
}

interface NavigationEvidence {
  cold: Record<string, NavigationTiming>;
  warmed: Record<string, NavigationTiming>;
}

const ADMIN_NAVIGATION_TARGETS: NavigationTarget[] = [
  { label: "Datasets", heading: "Datasets" },
  { label: "Thành viên", heading: "Thành viên" },
  { label: "Rubric", heading: "Quản lý metrics" },
  { label: "Tổng quan", heading: "Tổng quan" },
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
  const routeReadyPromise = page.evaluate((expectedHeading) => {
    return new Promise<number>((resolve, reject) => {
      let clickStart = 0;
      let observer: MutationObserver | null = null;
      const headingMatches = () =>
        Array.from(document.querySelectorAll("h1,h2,[role='heading']")).some((element) => element.textContent?.trim() === expectedHeading);
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
        if (headingMatches()) finish();
      };
      const timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for route content: ${expectedHeading}`));
      }, 10_000);

      document.addEventListener("click", onClick, true);
      observer = new MutationObserver(() => {
        if (clickStart > 0 && headingMatches()) finish();
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    });
  }, target.heading);

  await link.click();
  const [acknowledgementMs, routeReadyMs] = await Promise.all([acknowledgementPromise, routeReadyPromise]);
  await expect(page.getByRole("heading", { name: target.heading })).toBeVisible();
  await expect(link).toHaveAttribute("aria-current", "page");
  return { acknowledgementMs, routeReadyMs };
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
  }
});
