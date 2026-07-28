// Health-check endpoint - verifies route layer + env wiring.
// Smoke script (`pnpm smoke:local`) probes this before running other tests.

import { NextResponse } from "next/server";

export const runtime = "edge";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    ts: new Date().toISOString(),
    env: process.env.NODE_ENV ?? "unknown",
  });
}
