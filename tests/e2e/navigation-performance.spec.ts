import { expect, test, type Locator, type Page } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD ?? "local-dev-password";
const NAV_ACTIVE_THRESHOLD_MS = 100;
const ROUTE_RENDER_THRESHOLD_MS = 1500;

async function login(page: Page, email: string, landingPath: "/admin" | "/annotator") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL(new RegExp(`${landingPath}`));
}

async function measureNavigationAfterClick(page: Page, link: Locator, headingName: string) {
  const handle = await link.elementHandle();
  expect(handle).not.toBeNull();

  const activeTimingPromise = page.evaluate((target) => {
    return new Promise<number>((resolve, reject) => {
      let clickStart = 0;
      const cleanup = () => {
        window.clearTimeout(timeoutId);
        document.removeEventListener("click", onClick, true);
        observer.disconnect();
      };
      const finish = () => {
        cleanup();
        resolve(performance.now() - clickStart);
      };
      const onClick = (event: MouseEvent) => {
        if (event.target instanceof Node && target.contains(event.target)) {
          clickStart = performance.now();
          if (target.getAttribute("aria-current") === "page") finish();
        }
      };
      const observer = new MutationObserver(() => {
        if (clickStart > 0 && target.getAttribute("aria-current") === "page") finish();
      });
      const timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for nav active state"));
      }, 1_000);
      document.addEventListener("click", onClick, true);
      observer.observe(target, { attributes: true, attributeFilter: ["aria-current"] });
    });
  }, handle);
  const renderTimingPromise = page.evaluate((expectedHeading) => {
    return new Promise<number>((resolve, reject) => {
      const startedAt = performance.now();
      let timeoutId = 0;
      let observer: MutationObserver | null = null;
      const headingMatches = () =>
        Array.from(document.querySelectorAll("h1,h2,[role='heading']")).some((element) => element.textContent?.trim() === expectedHeading);
      const cleanup = () => {
        window.clearTimeout(timeoutId);
        observer?.disconnect();
      };
      const finish = () => {
        cleanup();
        resolve(performance.now() - startedAt);
      };

      if (headingMatches()) {
        finish();
        return;
      }

      observer = new MutationObserver(() => {
        if (headingMatches()) finish();
      });
      timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for ${expectedHeading}`));
      }, 3_000);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    });
  }, headingName);

  await link.click();
  const [activeMs, renderMs] = await Promise.all([activeTimingPromise, renderTimingPromise]);
  expect(activeMs).toBeLessThan(NAV_ACTIVE_THRESHOLD_MS);
  expect(renderMs).toBeLessThan(ROUTE_RENDER_THRESHOLD_MS);
  await expect(link).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: headingName })).toBeVisible();
}

test.describe("primary navigation responsiveness", () => {
  test("desktop admin primary navigation marks the clicked item active within 100ms", async ({ page }) => {
    await login(page, "admin@local.dev", "/admin");
    await page.goto("/admin/dashboard");
    await expect(page.getByRole("heading", { name: "Tổng quan" })).toBeVisible();

    const desktopNav = page.locator("aside nav");
    await expect(desktopNav).toBeVisible();
    const datasetsLink = desktopNav.getByRole("link", { name: "Datasets" });
    await expect(datasetsLink).not.toHaveAttribute("aria-current", "page");

    await measureNavigationAfterClick(page, datasetsLink, "Datasets");
  });

  test("desktop annotator primary navigation marks the clicked item active within 100ms", async ({ page }) => {
    await login(page, "annotator@local.dev", "/annotator");
    await page.goto("/annotator/tasks");
    await expect(page.getByRole("heading", { name: "Task của tôi" })).toBeVisible();

    const desktopNav = page.locator("aside nav");
    await expect(desktopNav).toBeVisible();
    const profileLink = desktopNav.getByRole("link", { name: "Hồ sơ" });
    await expect(profileLink).not.toHaveAttribute("aria-current", "page");

    await measureNavigationAfterClick(page, profileLink, "Hồ sơ annotator");
  });

  test("mobile admin primary navigation marks the clicked item active within 100ms", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, "admin@local.dev", "/admin");
    await page.goto("/admin/dashboard");
    await expect(page.getByRole("heading", { name: "Tổng quan" })).toBeVisible();

    const mobileNav = page.getByRole("navigation", { name: "Mobile navigation" });
    await expect(mobileNav).toBeVisible();
    const datasetsLink = mobileNav.getByRole("link", { name: "Datasets" });
    await expect(datasetsLink).not.toHaveAttribute("aria-current", "page");

    await measureNavigationAfterClick(page, datasetsLink, "Datasets");
  });

  test("mobile annotator primary navigation marks the clicked item active within 100ms", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, "annotator@local.dev", "/annotator");
    await page.goto("/annotator/tasks");
    await expect(page.getByRole("heading", { name: "Task của tôi" })).toBeVisible();

    const mobileNav = page.getByRole("navigation", { name: "Mobile navigation" });
    await expect(mobileNav).toBeVisible();
    const profileLink = mobileNav.getByRole("link", { name: "Hồ sơ" });
    await expect(profileLink).not.toHaveAttribute("aria-current", "page");

    await measureNavigationAfterClick(page, profileLink, "Hồ sơ annotator");
  });
});
