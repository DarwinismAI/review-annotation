import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

type CookieJar = Map<string, string>;

interface EndpointSpec {
  label: string;
  path: string;
  role: "admin" | "annotator";
}

interface TimingSample {
  durationMs: number;
  bytes: number;
  serverTiming: Record<string, number>;
}

interface TimingSummary {
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  bytesMax: number;
  serverTiming: Record<string, Omit<TimingSummary, "serverTiming">>;
}

const DEFAULT_RUNS = 10;
const WARM_P95_TARGET_MS = Number(process.env.NAV_BENCHMARK_TARGET_MS ?? 150);
const BASE_URL = process.env.BENCHMARK_BASE_URL ?? process.env.BASE_URL ?? process.env.E2E_BASE_URL;

function argValue(name: string): string | null {
  const prefix = `${name}=`;
  const arg = process.argv.slice(2).find((item) => item === name || item.startsWith(prefix));
  if (!arg) return null;
  if (arg === name) return "1";
  return arg.slice(prefix.length);
}

function normalizeBaseUrl() {
  const fromArg = argValue("--base-url");
  const raw = fromArg ?? BASE_URL;
  if (!raw) {
    throw new Error("ENV: set BENCHMARK_BASE_URL, BASE_URL, E2E_BASE_URL, or --base-url.");
  }
  return raw.replace(/\/$/, "");
}

function targetName() {
  return argValue("--target") ?? process.env.BENCHMARK_TARGET ?? "local";
}

function runCount() {
  const raw = argValue("--runs") ?? process.env.BENCHMARK_RUNS;
  const parsed = raw ? Number(raw) : DEFAULT_RUNS;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_RUNS;
}

function cookieHeader(jar: CookieJar): string {
  return Array.from(jar.entries()).map(([key, value]) => `${key}=${value}`).join("; ");
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

function jarFromCookie(rawCookie: string | undefined): CookieJar | null {
  if (!rawCookie) return null;
  const jar: CookieJar = new Map();
  for (const part of rawCookie.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key && valueParts.length > 0) jar.set(key, valueParts.join("="));
  }
  return jar.size > 0 ? jar : null;
}

async function loginWithDevEndpoint(baseUrl: string, role: "admin" | "annotator"): Promise<CookieJar | null> {
  const jar: CookieJar = new Map();
  const email = role === "admin" ? "admin@local.dev" : "annotator@local.dev";
  const password =
    role === "admin"
      ? process.env.ADMIN_PASSWORD ?? process.env.E2E_ADMIN_PASSWORD ?? process.env.E2E_PASSWORD ?? "local-dev-password"
      : process.env.EXPERT_PASSWORD ?? process.env.E2E_EXPERT_PASSWORD ?? process.env.E2E_PASSWORD ?? "local-dev-password";
  const response = await fetch(`${baseUrl}/api/dev/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`ENV: ${role} dev login failed with HTTP ${response.status}`);
  storeCookies(jar, response);
  return jar;
}

async function authJar(baseUrl: string, role: "admin" | "annotator"): Promise<CookieJar> {
  const cookieEnv = role === "admin" ? process.env.BENCHMARK_ADMIN_COOKIE : process.env.BENCHMARK_ANNOTATOR_COOKIE;
  const fromCookie = jarFromCookie(cookieEnv);
  if (fromCookie) return fromCookie;

  const fromDevLogin = await loginWithDevEndpoint(baseUrl, role);
  if (fromDevLogin) return fromDevLogin;

  throw new Error(`ENV: ${role} auth unavailable. Provide BENCHMARK_${role.toUpperCase()}_COOKIE for deployed targets.`);
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

async function requestJson(baseUrl: string, endpoint: EndpointSpec, jars: Record<EndpointSpec["role"], CookieJar>): Promise<TimingSample> {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${endpoint.path}`, {
    headers: {
      accept: "application/json",
      "cache-control": "no-store",
      cookie: cookieHeader(jars[endpoint.role]),
    },
  });
  const text = await response.text();
  const durationMs = performance.now() - started;
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status >= 500) throw new Error(`${endpoint.label} returned HTTP ${response.status}`);
  if (response.ok && !contentType.includes("application/json")) {
    throw new Error(`${endpoint.label} returned non-JSON 2xx content`);
  }
  if (!response.ok) throw new Error(`${endpoint.label} returned HTTP ${response.status}`);
  try {
    JSON.parse(text);
  } catch {
    throw new Error(`${endpoint.label} returned invalid JSON`);
  }
  return {
    durationMs,
    bytes: Buffer.byteLength(text),
    serverTiming: parseServerTiming(response.headers.get("server-timing")),
  };
}

function percentile(values: number[], fraction: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function summarizeDurations(values: number[], bytes: number[]): Omit<TimingSummary, "serverTiming"> {
  return {
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: Math.max(...values),
    bytesMax: Math.max(...bytes),
  };
}

function summarize(samples: TimingSample[]): TimingSummary {
  const durations = samples.map((sample) => sample.durationMs);
  const phaseNames = Array.from(new Set(samples.flatMap((sample) => Object.keys(sample.serverTiming))));
  return {
    ...summarizeDurations(durations, samples.map((sample) => sample.bytes)),
    serverTiming: Object.fromEntries(
      phaseNames.map((phase) => [phase, summarizeDurations(samples.map((sample) => sample.serverTiming[phase] ?? 0), samples.map(() => 0))])
    ),
  };
}

function formatMs(value: number) {
  return `${value.toFixed(1)} ms`;
}

async function main() {
  const baseUrl = normalizeBaseUrl();
  const target = targetName();
  const runs = runCount();
  const adminJar = await authJar(baseUrl, "admin");
  const annotatorJar = await authJar(baseUrl, "annotator");
  const jars = { admin: adminJar, annotator: annotatorJar };

  const datasetList = (await requestJson(baseUrl, { label: "admin.datasets.seed", path: "/api/datasets?page=1&pageSize=5&counts=1", role: "admin" }, jars)) as TimingSample;
  void datasetList;
  const listResponse = await fetch(`${baseUrl}/api/datasets?page=1&pageSize=5&counts=1`, {
    headers: { accept: "application/json", "cache-control": "no-store", cookie: cookieHeader(adminJar) },
  });
  const listPayload = (await listResponse.json()) as { datasets?: Array<{ id: string }> };
  const datasetId = listPayload.datasets?.[0]?.id;
  if (!datasetId) throw new Error("ENV: no dataset available for benchmark.");

  const endpoints: EndpointSpec[] = [
    { label: "admin.dashboard", path: "/api/admin/dashboard", role: "admin" },
    { label: "admin.datasets", path: "/api/datasets?page=1&pageSize=50&counts=1", role: "admin" },
    { label: "admin.members", path: "/api/admin/members", role: "admin" },
    { label: "admin.rubrics", path: "/api/rubrics", role: "admin" },
    { label: "admin.dataset.rows", path: `/api/datasets/${datasetId}/rows?page=1&pageSize=50&fields=list`, role: "admin" },
    { label: "annotator.task-groups", path: "/api/annotator/task-groups", role: "annotator" },
  ];

  const cold: Record<string, TimingSample> = {};
  const warm: Record<string, TimingSample[]> = {};
  for (const endpoint of endpoints) {
    cold[endpoint.label] = await requestJson(baseUrl, endpoint, jars);
    warm[endpoint.label] = [];
    for (let index = 0; index < runs; index += 1) {
      warm[endpoint.label].push(await requestJson(baseUrl, endpoint, jars));
    }
  }

  const warmSummary = Object.fromEntries(Object.entries(warm).map(([label, samples]) => [label, summarize(samples)]));
  const artifact = {
    target,
    baseUrlHostHash: createHash("sha256").update(new URL(baseUrl).host).digest("hex").slice(0, 16),
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? null,
    runs,
    targetWarmP95Ms: WARM_P95_TARGET_MS,
    cold,
    warmSummary,
  };
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const outDir = `test-results/api-fast-path-${stamp}`;
  await mkdir(outDir, { recursive: true });
  await writeFile(`${outDir}/benchmark-navigation.json`, JSON.stringify(artifact, null, 2));
  const lines = [
    `# API Fast Path Benchmark ${stamp}`,
    "",
    `Target: ${target}`,
    `Runs per endpoint: ${runs}`,
    "",
    "| Endpoint | Cold | Warm p50 | Warm p95 | Warm max | Bytes max |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...Object.entries(warmSummary).map(([label, summary]) => {
      const typed = summary as ReturnType<typeof summarize>;
      return `| ${label} | ${formatMs(cold[label].durationMs)} | ${formatMs(typed.p50Ms)} | ${formatMs(typed.p95Ms)} | ${formatMs(typed.maxMs)} | ${typed.bytesMax} |`;
    }),
  ];
  await writeFile(`${outDir}/summary.md`, `${lines.join("\n")}\n`);

  const overTarget = Object.entries(warmSummary).filter(([, summary]) => (summary as ReturnType<typeof summarize>).p95Ms > WARM_P95_TARGET_MS);
  console.log(`Benchmark evidence: ${outDir}`);
  if (overTarget.length > 0) {
    for (const [label, summary] of overTarget) {
      console.error(`${label} warm p95 ${formatMs((summary as ReturnType<typeof summarize>).p95Ms)} > ${formatMs(WARM_P95_TARGET_MS)}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
