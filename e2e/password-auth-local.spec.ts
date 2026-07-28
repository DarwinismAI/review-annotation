import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isLocalDevelopment } from "../src/lib/local-dev";

const localAuthEnabled = process.env.AUTH_TEST_MODE === "local";
const localAdminPassword = process.env.ADMIN_PASSWORD;

function runGuardedCommand(
  command: string,
  args: string[],
  env: Record<string, string | undefined>
) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

test("local auth mode is disabled in production even with a local database", () => {
  expect(isLocalDevelopment({
    NODE_ENV: "production",
    LOCAL_DB_PATH: "./local.db",
  })).toBe(false);
  expect(isLocalDevelopment({
    NODE_ENV: "development",
    LOCAL_DB_PATH: "./local.db",
  })).toBe(true);
  expect(isLocalDevelopment({
    NODE_ENV: "development",
  })).toBe(false);
});

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
      password: localAdminPassword ?? "missing-explicit-password",
    },
  });

  if (!localAuthEnabled) {
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ error: "NOT_FOUND" });
    return;
  }

  if (!localAdminPassword) {
    expect(response.status()).toBe(503);
    expect(await response.json()).toEqual({ error: "LOCAL_AUTH_NOT_CONFIGURED" });
    return;
  }

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ ok: true, role: "admin" });
  expect(response.headers()["set-cookie"]).toContain("dev_role=admin");
  expect(response.headers()["set-cookie"]).toContain("HttpOnly");
});

test("local password form creates the local role session", async ({ page }) => {
  test.skip(
    !localAuthEnabled || !localAdminPassword,
    "Local login requires local mode and an explicit ADMIN_PASSWORD"
  );

  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@local.dev");
  await page.getByLabel("Mật khẩu").fill(localAdminPassword!);
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

test("seed script rejects missing mutation opt-in before configuration or I/O", () => {
  const result = runGuardedCommand(
    "pnpm",
    ["tsx", "scripts/seed-test-review.ts"],
    {
      ALLOW_TEST_DATA_MUTATION: undefined,
      DATABASE_URL: undefined,
      SUPABASE_URL: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      E2E_ADMIN_PASSWORD: undefined,
      E2E_EXPERT_PASSWORD: undefined,
    }
  );

  expect(result.status).not.toBe(0);
  expect(result.output).toContain("ALLOW_TEST_DATA_MUTATION=1");
  expect(result.output).not.toContain("DATABASE_URL required");
  expect(result.output).not.toContain("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required");
});

test("base seed rejects missing mutation opt-in before configuration or I/O", () => {
  const result = runGuardedCommand(
    "pnpm",
    ["tsx", "scripts/seed.ts"],
    {
      ALLOW_SEED_MUTATION: undefined,
      DATABASE_URL: undefined,
      SUPABASE_URL: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      SEED_ADMIN_PASSWORD: undefined,
      SEED_EXPERT_PASSWORD: undefined,
    }
  );

  expect(result.status).not.toBe(0);
  expect(result.output).toContain("ALLOW_SEED_MUTATION=1");
  expect(result.output).not.toContain("DATABASE_URL is required");
  expect(result.output).not.toContain("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
});

test("base seed requires explicit admin and expert passwords without defaults", () => {
  const result = runGuardedCommand(
    "pnpm",
    ["tsx", "scripts/seed.ts"],
    {
      ALLOW_SEED_MUTATION: "1",
      DATABASE_URL: undefined,
      SUPABASE_URL: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      SEED_ADMIN_PASSWORD: undefined,
      SEED_EXPERT_PASSWORD: undefined,
    }
  );

  expect(result.status).not.toBe(0);
  expect(result.output).toContain("SEED_ADMIN_PASSWORD");
  expect(result.output).toContain("SEED_EXPERT_PASSWORD");
  expect(result.output).not.toContain("DATABASE_URL is required");

  const source = readFileSync("scripts/seed.ts", "utf8");
  expect(source).not.toContain("Password123!");
  expect(source).not.toContain("updateUserById");
  expect(source).toContain("if (existing) return existing.id;");
  expect(source).toContain(".update(schema.profiles)");
  expect(source).toContain(".set({ role: user.role, name: user.name");
});

test("production upload script rejects missing mutation opt-in before file or network access", () => {
  const result = runGuardedCommand(
    "bash",
    ["scripts/upload-zip.sh", "e2e/password-auth-local.spec.ts", "Guard test"],
    {
      BASE_URL: "https://example.invalid",
      ADMIN_SESSION_COOKIE: undefined,
      ALLOW_PROD_MUTATION: undefined,
    }
  );

  expect(result.status).not.toBe(0);
  expect(result.output).toContain("ALLOW_PROD_MUTATION=1");
  expect(result.output).not.toContain("unsupported extension");
});

test("production chunk import rejects missing mutation opt-in before ZIP or network access", () => {
  const result = runGuardedCommand(
    "pnpm",
    [
      "tsx",
      "scripts/import-travel-chunks-prod.ts",
      "--zip",
      "/definitely/not/read-before-mutation-guard.zip",
    ],
    {
      BASE_URL: "https://127.0.0.1:1",
      ADMIN_SESSION_COOKIE: undefined,
      ALLOW_PROD_MUTATION: undefined,
    }
  );

  expect(result.status).not.toBe(0);
  expect(result.output).toContain("ALLOW_PROD_MUTATION=1");
  expect(result.output).not.toContain("ENOENT");
});
