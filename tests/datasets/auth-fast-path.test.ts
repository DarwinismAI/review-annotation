import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const serverSource = readFileSync("src/lib/supabase/server.ts", "utf8");
const middlewareSource = readFileSync("src/lib/auth-middleware.ts", "utf8");
const authSource = readFileSync("src/lib/auth.ts", "utf8");

assert.match(serverSource, /isLocalDevelopment\(\)/);
assert.match(serverSource, /cookieStore\.get\("dev_role"\)/);
assert.match(serverSource, /normalizeRole/);

assert.match(serverSource, /supabase\.auth\.getClaims\(\)/);
assert.doesNotMatch(serverSource, /supabase\.auth\.getUser\(\)/);
assert.doesNotMatch(serverSource, /\.from\("profiles"\)/);
assert.doesNotMatch(serverSource, /JSON\.parse\([^)]*token|atob\(|decodeJwt|jwtDecode/);

assert.match(serverSource, /claims\.sub/);
assert.match(serverSource, /isUuid/);
assert.match(serverSource, /db\s*\.\s*select\(/);
assert.match(serverSource, /from\(profiles\)/);
assert.match(serverSource, /eq\(profiles\.id,\s*claims\.userId\)/);
assert.match(serverSource, /if \(!profile\) return null/);
assert.match(serverSource, /resolveEffectiveRole\(profile\.role,\s*profile\.email\)/);

assert.match(authSource, /getSession/);
assert.match(middlewareSource, /Server-Timing/);
assert.match(middlewareSource, /X-App-Server-Timing/);
assert.match(middlewareSource, /const header = timing\.header\(\)/);
assert.match(middlewareSource, /headers\.set\("Server-Timing", header\)/);
assert.match(middlewareSource, /headers\.set\("X-App-Server-Timing", header\)/);
assert.match(middlewareSource, /createRequestTiming/);
assert.doesNotMatch(middlewareSource, /auth\.api\.getSession/);
