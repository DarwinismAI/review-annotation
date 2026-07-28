import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@libsql/client";
import { expect, test, type APIRequestContext } from "@playwright/test";

const EXPERT_ID = "00000000-0000-0000-0000-000000000002";
const INVITE_ID = "signup-hardening-invite";
const databaseUrl = process.env.LOCAL_DB_PATH;
const localAuthEnabled = process.env.AUTH_TEST_MODE === "local";

function getDatabase() {
  if (!databaseUrl?.startsWith("file:")) {
    throw new Error("LOCAL_DB_PATH must use a local file for signup hardening tests");
  }
  return createClient({ url: databaseUrl });
}

async function resetExpert() {
  const database = getDatabase();
  await database.execute({
    sql: "DELETE FROM expert_profiles WHERE user_id = ?",
    args: [EXPERT_ID],
  });
  await database.execute({
    sql: `
      INSERT INTO profiles (id, email, role, name, created_at, updated_at)
      VALUES (?, ?, 'expert', NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET role = 'expert'
    `,
    args: [
      EXPERT_ID,
      "expert@expert-review.local",
      new Date().toISOString(),
      new Date().toISOString(),
    ],
  });
  database.close();
}

async function completeProfile(request: APIRequestContext) {
  return request.post("/api/expert/profile/complete", {
    headers: { Cookie: "dev_role=expert" },
    data: {
      name: "Invited Expert",
      domains: ["law"],
      sub_domains: [],
      medical_micro_domains: [],
    },
  });
}

test.describe("expert profile completion", () => {
  test.beforeEach(async () => {
    test.skip(!localAuthEnabled, "Local DB behavior requires AUTH_TEST_MODE=local");
    await resetExpert();
  });

  test.afterEach(async () => {
    if (!localAuthEnabled) return;
    await resetExpert();
  });

  test("an authenticated user without an admin-created invitation cannot activate", async ({
    request,
  }) => {
    const response = await completeProfile(request);

    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "INVITATION_REQUIRED",
        message: "Tài khoản chưa được quản trị viên mời",
      },
    });

    const database = getDatabase();
    const result = await database.execute({
      sql: "SELECT id FROM expert_profiles WHERE user_id = ?",
      args: [EXPERT_ID],
    });
    expect(result.rows).toHaveLength(0);
    database.close();
  });

  test("an admin-created pending expert profile can be activated without replacing it", async ({
    request,
  }) => {
    const database = getDatabase();
    const now = Date.now();
    await database.execute({
      sql: `
        INSERT INTO expert_profiles (
          id, user_id, domain, status, invited_at, created_at, updated_at
        ) VALUES (?, ?, 'law', 'pending', ?, ?, ?)
      `,
      args: [INVITE_ID, EXPERT_ID, now, now, now],
    });
    database.close();

    const response = await completeProfile(request);
    expect(response.status()).toBe(200);

    const updatedDatabase = getDatabase();
    const result = await updatedDatabase.execute({
      sql: "SELECT id, status FROM expert_profiles WHERE user_id = ?",
      args: [EXPERT_ID],
    });
    expect(result.rows).toEqual([{ id: INVITE_ID, status: "active" }]);
    updatedDatabase.close();
  });

  test("an inactive expert profile cannot reactivate itself", async ({ request }) => {
    const database = getDatabase();
    const now = Date.now();
    await database.execute({
      sql: `
        INSERT INTO expert_profiles (
          id, user_id, domain, status, invited_at, created_at, updated_at
        ) VALUES (?, ?, 'law', 'inactive', ?, ?, ?)
      `,
      args: [INVITE_ID, EXPERT_ID, now, now, now],
    });
    database.close();

    const response = await completeProfile(request);
    expect(response.status()).toBe(403);
    expect((await response.json()).error.code).toBe("PROFILE_INACTIVE");

    const updatedDatabase = getDatabase();
    const result = await updatedDatabase.execute({
      sql: "SELECT status FROM expert_profiles WHERE user_id = ?",
      args: [EXPERT_ID],
    });
    expect(result.rows).toEqual([{ status: "inactive" }]);
    updatedDatabase.close();
  });
});

test("auth trigger ignores user-controlled role metadata", () => {
  const migrationPath = resolve(
    process.cwd(),
    "migrations/0015_auth_signup_hardening.sql"
  );

  expect(existsSync(migrationPath)).toBe(true);
  const migration = readFileSync(migrationPath, "utf8");
  expect(migration).not.toContain("raw_user_meta_data");
  expect(migration).toMatch(
    /VALUES\s*\(\s*NEW\.id,\s*NEW\.email,\s*'expert'\s*\)[\s\S]*ON CONFLICT/
  );
});
