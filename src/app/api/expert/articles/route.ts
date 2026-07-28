// @ts-nocheck
import { NextResponse } from "next/server";
import { and, eq, inArray, desc, isNotNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { requireExpert } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import { articles, assignments, batches, expertDomains, articleReviewSession } from "@/db/schema";
import { isDomainKey, type DomainKey } from "@/lib/labels";

/**
 * GET /api/expert/articles?page=1&pageSize=20&domain=<domain-key>
 *
 * Multi-reviewer broadcast model: every matching-domain expert gets an assignment row
 * at signup / batch-create / article-enable (see lib/auto-assign.ts), so the legacy
 * "broadcast pool to claim" tab is gone. This endpoint paginates the caller's own list.
 *
 * Disabled articles (`enabled = false`) remain visible while the 24h grace window applies
 * — UI handles read-only banner.
 */
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export const GET = requireExpert(async (req, session) => {
  const expertId = session.user.id;
  const url = new URL(req.url);

  const rawPage = parseInt(url.searchParams.get("page") ?? "1", 10);
  const rawSize = parseInt(url.searchParams.get("pageSize") ?? `${DEFAULT_PAGE_SIZE}`, 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const pageSize = Number.isFinite(rawSize) && rawSize > 0 ? Math.min(rawSize, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  const domainFilter = url.searchParams.get("domain");
  const domainOk = isDomainKey(domainFilter) ? domainFilter : null;

  // Caller's domains (still surfaced for the domain filter chip row).
  const domainRows = await db
    .select({ domain: expertDomains.domain })
    .from(expertDomains)
    .where(eq(expertDomains.userId, expertId));
  const domains = domainRows.map((r) => r.domain);

  const where = domainOk
    ? and(eq(assignments.expertId, expertId), eq(batches.domain, domainOk))
    : eq(assignments.expertId, expertId);

  // Total count (cheap — no joins needed beyond batches when domain filter is on)
  const totalRows = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(assignments)
    .innerJoin(articles, eq(assignments.articleId, articles.id))
    .innerJoin(batches, eq(articles.batchId, batches.id))
    .where(where);
  const total = Number(totalRows[0]?.n ?? 0);

  const offset = (page - 1) * pageSize;
  const mineRows = await db
    .select({
      assignmentId: assignments.id,
      assignmentStatus: assignments.status,
      payRate: assignments.payRate,
      articleId: articles.id,
      articleTitle: articles.title,
      articleStatus: articles.status,
      articleEnabled: articles.enabled,
      articleDisabledAt: articles.disabledAt,
      batchId: batches.id,
      batchName: batches.name,
      batchDomain: batches.domain,
      batchAssignmentMode: batches.assignmentMode,
    })
    .from(assignments)
    .innerJoin(articles, eq(assignments.articleId, articles.id))
    .innerJoin(batches, eq(articles.batchId, batches.id))
    .where(where)
    .orderBy(desc(assignments.assignedAt))
    .limit(pageSize)
    .offset(offset);

  // Aggregate closed session time per assignment (seconds), only for current page.
  const assignmentIds = mineRows.map((r) => r.assignmentId);
  const timeMap = new Map<string, number>();
  if (assignmentIds.length > 0) {
    const timeRows = await db
      .select({
        assignmentId: articleReviewSession.assignmentId,
        totalSeconds: process.env.LOCAL_DB_PATH
          ? sql<number>`SUM(strftime('%s', ${articleReviewSession.endAt}) - strftime('%s', ${articleReviewSession.startAt}))`
          : sql<number>`SUM(EXTRACT(EPOCH FROM (${articleReviewSession.endAt} - ${articleReviewSession.startAt})))`,
      })
      .from(articleReviewSession)
      .where(
        and(
          inArray(articleReviewSession.assignmentId, assignmentIds),
          isNotNull(articleReviewSession.endAt)
        )
      )
      .groupBy(articleReviewSession.assignmentId);
    for (const r of timeRows) {
      timeMap.set(r.assignmentId, Number(r.totalSeconds ?? 0));
    }
  }

  const mine = mineRows.map((r) => ({
    id: r.articleId,
    title: r.articleTitle,
    status: r.assignmentStatus as "assigned" | "in_review" | "completed",
    domain: r.batchDomain as DomainKey,
    batchId: r.batchId,
    batchName: r.batchName,
    payRate: r.payRate,
    enabled: r.articleEnabled !== false,
    disabledAt:
      r.articleDisabledAt instanceof Date
        ? r.articleDisabledAt.toISOString()
        : r.articleDisabledAt,
    source: r.batchAssignmentMode === "broadcast" ? "broadcast-claimed" : "manual",
    totalSeconds: timeMap.has(r.assignmentId) ? timeMap.get(r.assignmentId)! : null,
  }));

  return NextResponse.json({
    data: {
      domains,
      mine,
      page,
      pageSize,
      total,
    },
  });
});
