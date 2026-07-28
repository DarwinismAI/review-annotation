// @ts-nocheck
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";

const IS_SQLITE = !!process.env.LOCAL_DB_PATH;

/**
 * GET /api/dashboard/admin/review-time?since=<ISO date>
 *
 * Returns per-batch time metrics (median, p95) and top-5 outliers.
 * Default lookback: 30 days.
 *
 * Dual implementation: PostgreSQL uses server-side percentile_cont;
 * SQLite fetches raw data and computes percentiles in JS.
 */
export const GET = requireAdmin(async (req) => {
  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam
    ? new Date(sinceParam).toISOString()
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  if (IS_SQLITE) return sqliteImpl(since);
  return postgresImpl(since);
});

// ─── SQLite: fetch raw durations, compute percentiles in JS ────────

async function sqliteImpl(since: string) {
  // Fetch all closed sessions with batch info
  const rows = await db.all(sql`
    SELECT
      a.batch_id,
      ars.assignment_id,
      (julianday(ars.end_at) - julianday(ars.start_at)) * 1440 AS minutes
    FROM article_review_session ars
    JOIN assignments asn ON asn.id = ars.assignment_id
    JOIN articles a ON a.id = asn.article_id
    WHERE ars.end_at IS NOT NULL
      AND ars.created_at >= ${since}
  `);

  // Group durations by batch
  const byBatch = new Map<string, number[]>();
  for (const r of rows) {
    const bid = r.batch_id as string;
    if (!byBatch.has(bid)) byBatch.set(bid, []);
    byBatch.get(bid)!.push(Number(r.minutes ?? 0));
  }

  /** Linear-interpolation percentile (same as percentile_cont). */
  function percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return Math.round(sorted[lo] * 10) / 10;
    const val = sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
    return Math.round(val * 10) / 10;
  }

  // Fetch batch names (single query, filter in JS)
  const allBatches = await db.all(sql`SELECT id, name FROM batches`);
  const nameMap: Record<string, string> = {};
  for (const b of allBatches) {
    nameMap[b.id] = b.name;
  }

  const metrics = [...byBatch.keys()].map((bid) => {
    const vals = byBatch.get(bid)!;
    return {
      batchId: bid,
      batchName: nameMap[bid] ?? bid,
      medianMinutes: percentile(vals, 50),
      p95Minutes: percentile(vals, 95),
      articleCount: vals.length,
    };
  });

  // Top-5 outliers
  const outlierRows = await db.all(sql`
    SELECT
      art.title,
      SUM((julianday(ars.end_at) - julianday(ars.start_at)) * 1440) AS minutes
    FROM article_review_session ars
    JOIN assignments asn ON asn.id = ars.assignment_id
    JOIN articles art ON art.id = asn.article_id
    WHERE ars.end_at IS NOT NULL
      AND ars.created_at >= ${since}
    GROUP BY art.id, art.title
    ORDER BY minutes DESC
    LIMIT 5
  `);

  const top5 = outlierRows.map((r) => ({
    title: r.title as string,
    minutes: Math.round(Number(r.minutes ?? 0)),
  }));

  return NextResponse.json({
    data: { since, metrics, top5Outliers: top5 },
  });
}

// ─── PostgreSQL: server-side percentile_cont ───────────────────────

async function postgresImpl(since: string) {
  const batchMetrics = await db.execute(sql`
    WITH article_durations AS (
      SELECT
        a.batch_id,
        ars.assignment_id,
        SUM(EXTRACT(EPOCH FROM (ars.end_at - ars.start_at))) / 60 AS minutes
      FROM article_review_session ars
      JOIN assignments asn ON asn.id = ars.assignment_id
      JOIN articles a ON a.id = asn.article_id
      WHERE ars.end_at IS NOT NULL AND ars.created_at >= ${since}
      GROUP BY a.batch_id, ars.assignment_id
    )
    SELECT
      batch_id,
      ROUND(CAST(percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes) AS numeric), 1) AS median_minutes,
      ROUND(CAST(percentile_cont(0.95) WITHIN GROUP (ORDER BY minutes) AS numeric), 1) AS p95_minutes,
      COUNT(*) AS article_count
    FROM article_durations
    GROUP BY batch_id
  `);

  const batchIds = (batchMetrics.rows ?? batchMetrics).map(
    (r: any) => r.batch_id as string
  );
  let batchNames: Record<string, string> = {};
  if (batchIds.length > 0) {
    const nameRows = await db.execute(sql`
      SELECT id, name FROM batches WHERE id = ANY(${batchIds})
    `);
    for (const r of nameRows.rows ?? nameRows) {
      batchNames[(r as any).id] = (r as any).name;
    }
  }

  const outliers = await db.execute(sql`
    SELECT
      art.title,
      SUM(EXTRACT(EPOCH FROM (ars.end_at - ars.start_at))) / 60 AS minutes
    FROM article_review_session ars
    JOIN assignments asn ON asn.id = ars.assignment_id
    JOIN articles art ON art.id = asn.article_id
    WHERE ars.end_at IS NOT NULL AND ars.created_at >= ${since}
    GROUP BY art.id, art.title
    ORDER BY minutes DESC
    LIMIT 5
  `);

  const metrics = (batchMetrics.rows ?? batchMetrics).map((r: any) => ({
    batchId: r.batch_id,
    batchName: batchNames[r.batch_id] ?? r.batch_id,
    medianMinutes: Number(r.median_minutes ?? 0),
    p95Minutes: Number(r.p95_minutes ?? 0),
    articleCount: Number(r.article_count ?? 0),
  }));

  const top5 = (outliers.rows ?? outliers).map((r: any) => ({
    title: r.title as string,
    minutes: Number(r.minutes ?? 0),
  }));

  return NextResponse.json({
    data: { since, metrics, top5Outliers: top5 },
  });
}
