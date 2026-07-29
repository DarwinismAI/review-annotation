type CookieJar = Map<string, string>;

const THRESHOLD_MS = Number(process.env.NAV_BENCHMARK_THRESHOLD_MS ?? 500);
const BASE_URL = process.env.BENCHMARK_BASE_URL ?? process.env.BASE_URL ?? process.env.E2E_BASE_URL;

function formatDuration(value: number): string {
  return `${value.toFixed(1)}ms`;
}

function cookieHeader(jar: CookieJar): string {
  return Array.from(jar.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

function storeCookies(jar: CookieJar, response: Response) {
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const rawCookies = getSetCookie ? getSetCookie.call(response.headers) : response.headers.get("set-cookie") ? [response.headers.get("set-cookie") as string] : [];
  for (const rawCookie of rawCookies) {
    const [pair] = rawCookie.split(";");
    const separator = pair.indexOf("=");
    if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

async function probeBaseUrl(): Promise<string> {
  if (!BASE_URL) {
    throw new Error("ENV: set BENCHMARK_BASE_URL to the local app that uses the same DB as pnpm run seed:perf.");
  }
  const baseUrl = BASE_URL.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/api/dev/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@review-annotation.local", password: process.env.ADMIN_PASSWORD ?? "local-dev-password" }),
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 404) {
    throw new Error(`ENV: ${baseUrl} does not expose local dev login. Set BENCHMARK_BASE_URL to this app.`);
  }
  return baseUrl;
}

async function login(baseUrl: string, role: "admin" | "annotator"): Promise<CookieJar> {
  const jar: CookieJar = new Map();
  const email = role === "admin" ? "admin@review-annotation.local" : "annotator@review-annotation.local";
  const password = role === "admin" ? process.env.ADMIN_PASSWORD ?? "local-dev-password" : process.env.EXPERT_PASSWORD ?? "local-dev-password";
  const response = await fetch(`${baseUrl}/api/dev/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  storeCookies(jar, response);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ENV: ${role} local dev login failed with HTTP ${response.status}: ${body}`);
  }
  return jar;
}

async function requestJson(baseUrl: string, path: string, jar: CookieJar) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { cookie: cookieHeader(jar) },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${path} failed with HTTP ${response.status}: ${body}`);
  }
  return response.json() as Promise<unknown>;
}

async function measure(baseUrl: string, label: string, path: string, jar: CookieJar): Promise<number> {
  const started = performance.now();
  await requestJson(baseUrl, path, jar);
  const duration = performance.now() - started;
  console.log(`${label}: ${formatDuration(duration)} ${path}`);
  return duration;
}

async function main() {
  const baseUrl = await probeBaseUrl();
  console.log(`Benchmark base URL: ${baseUrl}`);
  console.log(`Threshold: ${formatDuration(THRESHOLD_MS)}`);

  const adminJar = await login(baseUrl, "admin");
  const annotatorJar = await login(baseUrl, "annotator");
  const datasetList = (await requestJson(baseUrl, "/api/datasets", adminJar)) as { datasets?: Array<{ id: string; name: string }> };
  const dataset = datasetList.datasets?.find((item) => item.id.startsWith("nav_perf_dataset_")) ?? datasetList.datasets?.[0];
  if (!dataset) {
    throw new Error("ENV: no dataset found. Run pnpm run seed:perf against the same LOCAL_DB_PATH used by the local app.");
  }

  const endpoints = [
    { label: "admin.datasets", path: "/api/datasets", jar: adminJar },
    { label: "admin.members", path: "/api/admin/members", jar: adminJar },
    { label: "admin.dataset.detail", path: `/api/datasets/${dataset.id}`, jar: adminJar },
    { label: "admin.dataset.rows", path: `/api/datasets/${dataset.id}/rows?page=1&pageSize=200`, jar: adminJar },
    { label: "annotator.tasks", path: "/api/annotator/tasks?page=1&pageSize=200", jar: annotatorJar },
  ];

  for (const endpoint of endpoints) {
    await requestJson(baseUrl, endpoint.path, endpoint.jar);
  }

  const results = [];
  for (const endpoint of endpoints) {
    const duration = await measure(baseUrl, endpoint.label, endpoint.path, endpoint.jar);
    results.push({ ...endpoint, duration });
  }

  const failures = results.filter((result) => result.duration > THRESHOLD_MS);
  if (failures.length > 0) {
    console.error("Navigation API benchmark failed:");
    for (const failure of failures) {
      console.error(`- ${failure.label}: ${formatDuration(failure.duration)} > ${formatDuration(THRESHOLD_MS)}`);
    }
    process.exit(1);
  }

  console.log("Navigation API benchmark passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
