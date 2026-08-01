import assert from "node:assert/strict";
import { runAuthorizedRead } from "../../src/lib/read-auth-flow";

async function main() {
  let handlerStarted = false;
  const invalidClaims = await runAuthorizedRead({
    getClaims: async () => null,
    getProfile: async () => {
      throw new Error("profile must not start");
    },
    startHandler: () => {
      handlerStarted = true;
      return Promise.resolve("secret");
    },
    isAllowed: () => true,
  });
  assert.equal(invalidClaims.status, "unauthorized");
  assert.equal(handlerStarted, false);

  let discarded = false;
  const wrongRole = await runAuthorizedRead({
    getClaims: async () => ({ userId: "user-1", email: "user@example.com" }),
    getProfile: async () => ({ user: { id: "user-1", email: "user@example.com", name: null, role: "annotator" } }),
    startHandler: () => {
      discarded = true;
      return Promise.resolve("secret");
    },
    isAllowed: (session) => session.user.role === "admin",
  });
  assert.equal(wrongRole.status, "forbidden");
  assert.equal(discarded, true);
  assert.equal("response" in wrongRole, false);

  let missingProfileHandlerStarted = false;
  const missingProfile = await runAuthorizedRead({
    getClaims: async () => ({ userId: "disabled-user", email: "disabled@example.com" }),
    getProfile: async () => null,
    startHandler: () => {
      missingProfileHandlerStarted = true;
      return Promise.resolve("secret");
    },
    isAllowed: () => true,
  });
  assert.equal(missingProfile.status, "unauthorized");
  assert.equal(missingProfileHandlerStarted, true);
  assert.equal("response" in missingProfile, false);

  let profileLookedUp = false;
  const allowed = await runAuthorizedRead({
    getClaims: async () => ({ userId: "user-2", email: "admin@example.com" }),
    getProfile: async () => {
      profileLookedUp = true;
      return { user: { id: "user-2", email: "admin@example.com", name: "Admin", role: "admin" } };
    },
    startHandler: () => Promise.resolve("ok"),
    isAllowed: (session) => session.user.role === "admin",
  });
  assert.equal(allowed.status, "authorized");
  assert.equal(profileLookedUp, true);
  assert.equal(allowed.response, "ok");
}

main();
