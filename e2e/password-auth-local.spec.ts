import { expect, test } from "@playwright/test";

const localAuthEnabled = process.env.AUTH_TEST_MODE === "local";

test("login uses email and password without public signup or OTP", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Đăng nhập" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Mật khẩu")).toBeVisible();
  await expect(page.getByRole("button", { name: "Đăng nhập" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Đăng ký/i })).toHaveCount(0);
  await expect(page.getByText(/OTP/i)).toHaveCount(0);
});

test("legacy signup and OTP pages return to password login", async ({ page }) => {
  for (const path of ["/login/otp", "/signup", "/signup/otp", "/signup/profile"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel("Mật khẩu")).toBeVisible();
  }
});

test("public signup and admin shortcut APIs are disabled", async ({ request }) => {
  const [signup, shortcut] = await Promise.all([
    request.post("/api/signup/password", {
      data: { email: "new@example.com", password: "not-a-real-password" },
    }),
    request.post("/api/admin-shortcut", {
      data: { email: "admin@example.com", otp: "012345" },
    }),
  ]);

  expect(signup.status()).toBe(410);
  expect((await signup.json()).error.code).toBe("SIGNUP_DISABLED");
  expect(shortcut.status()).toBe(410);
  expect((await shortcut.json()).error.code).toBe("PASSWORD_LOGIN_REQUIRED");
});

test("dev login is available only with local database mode", async ({ request }) => {
  const response = await request.post("/api/dev/login", {
    data: {
      email: "admin@local.dev",
      password: process.env.ADMIN_PASSWORD ?? "admin123",
    },
  });

  if (!localAuthEnabled) {
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ error: "NOT_FOUND" });
    return;
  }

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ ok: true, role: "admin" });
  expect(response.headers()["set-cookie"]).toContain("dev_role=admin");
  expect(response.headers()["set-cookie"]).toContain("HttpOnly");
});

test("local password form creates the local role session", async ({ page }) => {
  test.skip(!localAuthEnabled, "Local login is exercised only with LOCAL_DB_PATH set");

  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@local.dev");
  await page.getByLabel("Mật khẩu").fill(process.env.ADMIN_PASSWORD ?? "admin123");
  await page.getByRole("button", { name: "Đăng nhập" }).click();

  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === "dev_role")?.value).toBe("admin");
});

test("non-local password form falls back to Supabase password auth", async ({ page }) => {
  test.skip(localAuthEnabled, "Supabase fallback is exercised only without LOCAL_DB_PATH");

  let credentials: { email?: string; password?: string } = {};
  await page.route("**/auth/v1/token?grant_type=password", async (route) => {
    credentials = route.request().postDataJSON() as typeof credentials;
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: "invalid_grant",
        error_description: "Invalid login credentials",
      }),
    });
  });

  await page.goto("/login");
  await page.getByLabel("Email").fill("existing@example.com");
  await page.getByLabel("Mật khẩu").fill("wrong-password");
  await page.getByRole("button", { name: "Đăng nhập" }).click();

  await expect(page.getByText("Invalid login credentials")).toBeVisible();
  expect(credentials).toEqual({
    email: "existing@example.com",
    password: "wrong-password",
    gotrue_meta_security: {},
  });
});
