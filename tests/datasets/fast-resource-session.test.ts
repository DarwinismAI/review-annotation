import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fastResource = readFileSync("src/hooks/use-fast-resource.ts", "utf8");
const authClient = readFileSync("src/lib/auth-client.ts", "utf8");
const appShell = readFileSync("src/components/app-shell.tsx", "utf8");
const fastResourceSessionPath = "src/components/fast-resource-session.tsx";
const devLogoutRoute = readFileSync("src/app/api/dev/logout/route.ts", "utf8");

assert.match(fastResource, /export function setFastResourceSession\(userId: string \| null\)/);
assert.match(fastResource, /export function clearFastResourceCache\(\)/);
assert.match(fastResource, /export async function preloadFastResource\(url: string/);
assert.match(fastResource, /const pendingLoads = new Map/);
assert.match(fastResource, /fastResourceKey\(currentSessionId, url\)/);
assert.match(fastResource, /currentSessionId/);
assert.match(fastResource, /\$\{sessionId \?\? "anonymous"\}:\$\{url\}/);
assert.doesNotMatch(fastResource, /cache\.get\(url\)/);
assert.doesNotMatch(fastResource, /cache\.set\(url,/);

assert.match(authClient, /clearFastResourceCache\(\);[\s\S]*signInWithPassword/);
assert.match(authClient, /clearFastResourceCache\(\);[\s\S]*signOut/);
assert.match(authClient, /isLocalhost/);
assert.match(authClient, /fetch\("\/api\/dev\/logout", \{ method: "POST" \}\)/);
assert.match(authClient, /localRes\.status !== 404/);
assert.match(authClient, /return;/);
assert.match(authClient, /setFastResourceSession\(user\.id\)/);
assert.match(authClient, /setFastResourceSession\(null\)/);

assert.match(devLogoutRoute, /export async function POST/);
assert.match(devLogoutRoute, /isLocalDevelopment\(\)/);
assert.match(devLogoutRoute, /response\.cookies\.set\("dev_role", ""/);
assert.match(devLogoutRoute, /maxAge: 0/);
assert.match(devLogoutRoute, /httpOnly: true/);
assert.match(devLogoutRoute, /sameSite: "lax"/);

assert.match(appShell, /import \{ FastResourceSession \} from "\.\/fast-resource-session";/);
assert.match(appShell, /<FastResourceSession userId=\{session\.userId\}>/);

const fastResourceSession = readFileSync(fastResourceSessionPath, "utf8");
assert.match(fastResourceSession, /^"use client";/);
assert.match(fastResourceSession, /setFastResourceSession\(userId\)/);
