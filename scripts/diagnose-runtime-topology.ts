import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

type ProbeResult = {
  url: string;
  status: number | null;
  xVercelId: string | null;
  functionRegion: string | null;
  serverTiming: string | null;
  error: string | null;
};

type JwtResult = {
  algorithm: string | null;
  publicJwksAvailable: boolean;
  error: string | null;
};

function argValue(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function redactUrl(value: string) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value.split("?")[0] ?? value;
  }
}

function functionRegionFromVercelId(value: string | null) {
  return value?.split("::")[0]?.split(":")[0] ?? null;
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]") : "unknown error";
}

async function probeDeployment(url: string, token?: string): Promise<ProbeResult> {
  try {
    const response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      redirect: "manual",
    });
    const xVercelId = response.headers.get("x-vercel-id");
    return {
      url: redactUrl(url),
      status: response.status,
      xVercelId,
      functionRegion: functionRegionFromVercelId(xVercelId),
      serverTiming: response.headers.get("server-timing"),
      error: null,
    };
  } catch (error) {
    return {
      url: redactUrl(url),
      status: null,
      xVercelId: null,
      functionRegion: null,
      serverTiming: null,
      error: safeError(error),
    };
  }
}

async function inspectJwt(supabaseUrl: string | undefined, anonKey: string | undefined, accessToken: string | undefined): Promise<JwtResult> {
  if (!supabaseUrl || !anonKey || !accessToken) {
    return { algorithm: null, publicJwksAvailable: false, error: "supabase url, anon key, or access token not supplied" };
  }

  let publicJwksAvailable = false;
  try {
    const jwksResponse = await fetch(new URL("/auth/v1/.well-known/jwks.json", supabaseUrl));
    publicJwksAvailable = jwksResponse.ok;
  } catch {
    publicJwksAvailable = false;
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(accessToken);
  if (error || !data?.header?.alg) {
    return { algorithm: null, publicJwksAvailable, error: error?.message ?? "claims unavailable" };
  }
  return { algorithm: data.header.alg, publicJwksAvailable, error: null };
}

async function main() {
  const deploymentUrl = argValue("url") ?? process.env.DIAG_DEPLOYMENT_URL;
  const branch = argValue("branch") ?? process.env.DIAG_BRANCH_LABEL ?? null;
  const probePath = argValue("path") ?? "/api/datasets?page=1&pageSize=1";
  const accessToken = process.env.DIAG_SUPABASE_ACCESS_TOKEN;
  const authHeaderToken = process.env.DIAG_HTTP_BEARER_TOKEN;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const outputDir = path.join("test-results", `api-fast-path-${timestamp}`);
  const probeUrl = deploymentUrl ? new URL(probePath, deploymentUrl).toString() : null;

  const artifact = {
    generatedAt: new Date().toISOString(),
    branch,
    deployment: deploymentUrl ? redactUrl(deploymentUrl) : null,
    probe: probeUrl ? await probeDeployment(probeUrl, authHeaderToken) : null,
    supabase: {
      urlHost: supabaseUrl ? new URL(supabaseUrl).host : null,
      jwt: await inspectJwt(supabaseUrl, anonKey, accessToken),
    },
    database: {
      region: process.env.DIAG_SUPABASE_DB_REGION ?? null,
      source: process.env.DIAG_SUPABASE_DB_REGION ? "DIAG_SUPABASE_DB_REGION" : null,
    },
  };

  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "topology.json");
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(outputPath);
}

main().catch((error) => {
  console.error(safeError(error));
  process.exit(1);
});
