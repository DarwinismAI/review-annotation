import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import { batches, articles, articleParagraphs, articleSegments } from "@/db/schema";
import { eq, and, count, inArray } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { uploadFile, downloadFile } from "@/lib/supabase-storage";
import JSZip from "jszip";
import { extractParagraphs } from "@/lib/pdf-extract";
import { extractColoredSegments } from "@/lib/pdf-color-extract";
import { assignBroadcastForBatch } from "@/lib/auto-assign";
import {
  isSubDomainKey,
  isDomainKey,
  domainForSubDomain,
  isMedicalMicroDomainKey,
  subDomainForMedicalMicroDomain,
  type DomainKey,
} from "@/lib/labels";

/**
 * Extract + validate sub_domain_id from a JSON article payload.
 * Accepts both `sub_domain_id` and `subDomainId` keys (publisher-side naming drift).
 * Rejects values whose parent domain mismatches the batch's domain - null on mismatch
 * keeps the row insertable; broadcast filter then treats it as "no narrowing".
 */
function extractArticleTaxonomy(payload: Record<string, unknown>, batchDomain: DomainKey) {
  const raw = payload.sub_domain_id ?? payload.subDomainId;
  const subDomainId =
    typeof raw === "string" && isSubDomainKey(raw) && domainForSubDomain(raw) === batchDomain
      ? raw
      : null;

  const rawMicro =
    payload.medical_micro_domain_id ??
    payload.medicalMicroDomainId ??
    payload.sub_sub_domain_id ??
    payload.subSubDomainId;
  if (batchDomain !== "medical" || typeof rawMicro !== "string" || !isMedicalMicroDomainKey(rawMicro)) {
    return { subDomainId, medicalMicroDomainId: null };
  }

  const parent = subDomainForMedicalMicroDomain(rawMicro);
  if (!parent) return { subDomainId, medicalMicroDomainId: null };
  if (subDomainId && subDomainId !== parent) {
    return { subDomainId, medicalMicroDomainId: null };
  }
  return { subDomainId: subDomainId ?? parent, medicalMicroDomainId: rawMicro };
}

// Process ZIPs up to ~200MB downloaded from Supabase Storage.
// (Platform-side body limit no longer applies - client uploads to storage directly.)
const MAX_FILE_SIZE = 500 * 1024 * 1024;

// Let the Node runtime allocate more time for large ZIPs.
export const runtime = "nodejs";
export const maxDuration = 60;

/** GET /api/batches - list batches (admin only) */
export const GET = requireAdmin(async (req) => {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const domain = searchParams.get("domain");

  const conditions = [];
  if (status) conditions.push(eq(batches.status, status));
  if (domain) conditions.push(eq(batches.domain, domain));

  const rows = await db
    .select()
    .from(batches)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(batches.createdAt);

  const batchIds = rows.map((row: { id: string }) => row.id);
  const subDomainCountsByBatch = new Map<string, Array<{ id: string | null; count: number }>>();

  if (batchIds.length > 0) {
    const subDomainRows = await db
      .select({
        batchId: articles.batchId,
        subDomainId: articles.subDomainId,
        total: count(),
      })
      .from(articles)
      .where(inArray(articles.batchId, batchIds))
      .groupBy(articles.batchId, articles.subDomainId);

    for (const row of subDomainRows) {
      const list = subDomainCountsByBatch.get(row.batchId) ?? [];
      list.push({ id: row.subDomainId, count: Number(row.total) });
      subDomainCountsByBatch.set(row.batchId, list);
    }
  }

  return NextResponse.json({
    data: rows.map((row: { id: string }) => ({
      ...row,
      subDomainCounts: subDomainCountsByBatch.get(row.id) ?? [],
    })),
  });
});

/**
 * POST /api/batches - create batch from a ZIP already uploaded to Supabase Storage.
 *
 * Request JSON: { name, domain, articleType, payRatePerArticle?, storageKey, filename }
 *   storageKey - path returned by /api/batches/upload-url (client PUT target)
 *   filename   - original filename (for display, persisted on the batch row)
 *
 * Server downloads the ZIP from storage (not via the request body → bypasses the
 * Vercel ~4.5MB function body limit), validates + extracts PDFs, writes batch + articles.
 */
export const POST = requireAdmin(async (req, session) => {
  let body: {
    name?: string;
    domain?: string;
    articleType?: string;
    payRatePerArticle?: number | string;
    storageKey?: string;
    filename?: string;
    assignmentMode?: string;
    broadcastExpiresAt?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Yêu cầu phải là JSON" } },
      { status: 400 }
    );
  }

  const { name, domain, articleType, storageKey, filename } = body;

  if (!name || !domain || !articleType || !storageKey || !filename) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Thiếu trường bắt buộc: name, domain, articleType, storageKey, filename" } },
      { status: 400 }
    );
  }

  if (!storageKey.startsWith("_staging/")) {
    return NextResponse.json(
      { error: { code: "INVALID_STORAGE_KEY", message: "storageKey không hợp lệ" } },
      { status: 400 }
    );
  }

  if (!isDomainKey(domain)) {
    return NextResponse.json(
      { error: { code: "INVALID_DOMAIN", message: "Lĩnh vực không hợp lệ" } },
      { status: 400 }
    );
  }

  if (!["full", "paragraph"].includes(articleType)) {
    return NextResponse.json(
      { error: { code: "INVALID_ARTICLE_TYPE", message: "Loại bài phải là 'full' hoặc 'paragraph'" } },
      { status: 400 }
    );
  }

  // Assignment mode (manual = admin pick annotators later, broadcast = self-claim).
  const assignmentMode = body.assignmentMode ?? "manual";
  if (!["manual", "broadcast"].includes(assignmentMode)) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_ASSIGNMENT_MODE",
          message: "assignmentMode phải là 'manual' hoặc 'broadcast'",
        },
      },
      { status: 400 }
    );
  }

  let broadcastExpiresAtMs: number | null = null;
  if (assignmentMode === "broadcast") {
    if (!body.broadcastExpiresAt) {
      return NextResponse.json(
        {
          error: {
            code: "BROADCAST_DEADLINE_REQUIRED",
            message: "Mode 'Tự động' cần hạn nhận bài (broadcastExpiresAt)",
          },
        },
        { status: 400 }
      );
    }
    const ts = Date.parse(body.broadcastExpiresAt);
    if (isNaN(ts) || ts <= Date.now()) {
      return NextResponse.json(
        {
          error: {
            code: "BROADCAST_DEADLINE_INVALID",
            message: "Hạn nhận bài phải là ngày hợp lệ ở tương lai",
          },
        },
        { status: 400 }
      );
    }
    broadcastExpiresAtMs = ts;
  }

  const payRatePerArticle =
    typeof body.payRatePerArticle === "string"
      ? parseInt(body.payRatePerArticle, 10) || 0
      : body.payRatePerArticle ?? 0;
  const batchId = createId();
  const now = Date.now();

  const lowerFilename = filename.toLowerCase();
  const isJsonUpload = lowerFilename.endsWith(".json");
  const isZipUpload = lowerFilename.endsWith(".zip");
  if (!isJsonUpload && !isZipUpload) {
    return NextResponse.json(
      { error: { code: "INVALID_FILENAME", message: "File phải là .json hoặc .zip" } },
      { status: 400 }
    );
  }

  // Pull the staged file back out of Supabase Storage.
  let sourceBuffer: Buffer;
  try {
    sourceBuffer = await downloadFile(storageKey);
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: "SOURCE_NOT_FOUND",
          message: err instanceof Error ? err.message : "Không đọc được file đã upload",
        },
      },
      { status: 400 }
    );
  }

  if (sourceBuffer.length > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: { code: "FILE_TOO_LARGE", message: "File vượt quá giới hạn 500MB" } },
      { status: 413 }
    );
  }

  type ArticleInsert = {
    id: string;
    title: string;
    sourceFormat: "json" | "pdf";
    pdfKey: string | null;
    sourceKey: string | null;
    payloadJson: string | null;
    subDomainId: string | null;
    medicalMicroDomainId: string | null;
  };

  type SegmentData = Awaited<ReturnType<typeof extractColoredSegments>>;

  const errorFiles: string[] = [];
  const successArticles: ArticleInsert[] = [];
  const paragraphsMap = new Map<string, string[]>();
  const segmentsMap = new Map<string, NonNullable<SegmentData>>();

  // Single-JSON path → exactly one article holding the parsed payload verbatim.
  // ZIP path → scan entries; .json entries become JSON articles, .pdf entries flow
  // through the legacy PDF extraction (back-compat with the original color-PDF batches).
  let canonicalSourceKey: string;

  if (isJsonUpload) {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(sourceBuffer.toString("utf8")) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: { code: "INVALID_JSON", message: "File JSON không hợp lệ" } },
        { status: 400 }
      );
    }

    canonicalSourceKey = `${batchId}/${filename}`;
    await uploadFile(canonicalSourceKey, sourceBuffer, "application/json");

    const articleId = createId();
    const articleSourceKey = `${batchId}/sources/${articleId}.json`;
    await uploadFile(articleSourceKey, sourceBuffer, "application/json");

    const title =
      (typeof payload.title === "string" && payload.title.trim()) ||
      (typeof payload.slug === "string" && payload.slug.trim()) ||
      filename.replace(/\.json$/i, "");

    const taxonomy = extractArticleTaxonomy(payload, domain as DomainKey);
    successArticles.push({
      id: articleId,
      title,
      sourceFormat: "json",
      pdfKey: null,
      sourceKey: articleSourceKey,
      payloadJson: sourceBuffer.toString("utf8"),
      subDomainId: taxonomy.subDomainId,
      medicalMicroDomainId: taxonomy.medicalMicroDomainId,
    });
  } else {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(sourceBuffer);
    } catch {
      return NextResponse.json(
        { error: { code: "INVALID_ZIP", message: "File không phải định dạng ZIP hợp lệ" } },
        { status: 400 }
      );
    }

    canonicalSourceKey = `${batchId}/${filename}`;
    await uploadFile(canonicalSourceKey, sourceBuffer, "application/zip");

    const jsonEntries = Object.entries(zip.files).filter(
      ([name, entry]) => !entry.dir && name.toLowerCase().endsWith(".json")
    );
    const pdfEntries = Object.entries(zip.files).filter(
      ([name, entry]) => !entry.dir && name.toLowerCase().endsWith(".pdf")
    );

    if (jsonEntries.length === 0 && pdfEntries.length === 0) {
      return NextResponse.json(
        { error: { code: "NO_ARTICLES_FOUND", message: "File ZIP không chứa file .json hoặc .pdf nào" } },
        { status: 400 }
      );
    }

    for (const [entryName, entry] of jsonEntries) {
      const safeFilename = entryName.split("/").pop() ?? entryName;
      try {
        const buf = Buffer.from(await entry.async("uint8array"));
        const text = buf.toString("utf8");
        const payload = JSON.parse(text) as Record<string, unknown>;
        const articleId = createId();
        const articleSourceKey = `${batchId}/sources/${articleId}.json`;
        await uploadFile(articleSourceKey, buf, "application/json");

        const title =
          (typeof payload.title === "string" && payload.title.trim()) ||
          (typeof payload.slug === "string" && payload.slug.trim()) ||
          safeFilename.replace(/\.json$/i, "");

        const taxonomy = extractArticleTaxonomy(payload, domain as DomainKey);
        successArticles.push({
          id: articleId,
          title,
          sourceFormat: "json",
          pdfKey: null,
          sourceKey: articleSourceKey,
          payloadJson: text,
          subDomainId: taxonomy.subDomainId,
          medicalMicroDomainId: taxonomy.medicalMicroDomainId,
        });
      } catch {
        errorFiles.push(safeFilename);
      }
    }

    for (const [entryName, entry] of pdfEntries) {
      const safeFilename = entryName.split("/").pop() ?? entryName;
      try {
        const pdfBuffer = Buffer.from(await entry.async("uint8array"));
        const articleId = createId();
        const pdfKey = `${batchId}/pdfs/${articleId}.pdf`;
        await uploadFile(pdfKey, pdfBuffer, "application/pdf");
        successArticles.push({
          id: articleId,
          title: safeFilename,
          sourceFormat: "pdf",
          pdfKey,
          sourceKey: null,
          payloadJson: null,
          subDomainId: null,
          medicalMicroDomainId: null,
        });

        let segments: SegmentData = null;
        try {
          segments = await extractColoredSegments(pdfBuffer);
          if (segments && segments.length > 0) {
            segmentsMap.set(articleId, segments);
          }
        } catch (colorErr) {
          console.error(`[batches] color extraction failed for ${safeFilename}:`, colorErr);
        }

        if (articleType === "paragraph" && !segments) {
          try {
            const paras = await extractParagraphs(pdfBuffer);
            if (paras.length > 0) paragraphsMap.set(articleId, paras);
          } catch (parseErr) {
            console.error(`[batches] paragraph extraction failed for ${safeFilename}:`, parseErr);
          }
        }
      } catch {
        errorFiles.push(safeFilename);
      }
    }
  }

  if (successArticles.length === 0) {
    return NextResponse.json(
      { error: { code: "NO_ARTICLES_PARSED", message: "Không parse được bài nào từ file đã upload" } },
      { status: 400 }
    );
  }

  // Insert batch row
  await db.insert(batches).values({
    id: batchId,
    name,
    domain,
    articleType,
    zipStorageKey: canonicalSourceKey,
    totalArticles: successArticles.length,
    errorFiles: errorFiles.length ? JSON.stringify(errorFiles) : null,
    payRatePerArticle,
    status: "ready",
    assignmentMode,
    broadcastExpiresAt: broadcastExpiresAtMs ? new Date(broadcastExpiresAtMs) : null,
    createdBy: session.user.id,
    createdAt: now,
    updatedAt: now,
  });

  // Insert article rows
  await db.insert(articles).values(
    successArticles.map((a) => ({
      id: a.id,
      batchId,
      title: a.title,
      type: articleType,
      pdfStorageKey: a.pdfKey,
      sourceFormat: a.sourceFormat,
      sourceStorageKey: a.sourceKey,
      payloadJson: a.payloadJson,
      subDomainId: a.subDomainId,
      medicalMicroDomainId: a.medicalMicroDomainId,
      status: "unassigned" as const,
      createdAt: now,
      updatedAt: now,
    }))
  );

  // Insert paragraph rows for paragraph-type articles (fallback when no color layer)
  if (paragraphsMap.size > 0) {
    const paragraphRows = [];
    for (const [articleId, paras] of paragraphsMap) {
      for (let i = 0; i < paras.length; i++) {
        paragraphRows.push({
          id: createId(),
          articleId,
          paragraphIndex: i,
          text: paras[i],
          createdAt: now,
        });
      }
    }
    if (paragraphRows.length > 0) {
      await db.insert(articleParagraphs).values(paragraphRows);
    }
  }

  // Insert colored segment rows for articles where color layer was detected
  if (segmentsMap.size > 0) {
    const segmentRows = [];
    for (const [articleId, segs] of segmentsMap) {
      for (const seg of segs) {
        segmentRows.push({
          id: createId(),
          articleId,
          order: seg.order,
          text: seg.text,
          color: seg.color,
          type: seg.type,
          scoreValue: seg.scoreValue ?? null,
          pageIndex: seg.pageIndex,
          createdAt: now,
        });
      }
    }
    if (segmentRows.length > 0) {
      await db.insert(articleSegments).values(segmentRows);
    }
  }

  // Broadcast batches: fan out all newly-inserted articles to every matching-domain expert.
  // Manual batches: no-op (admin will assign individually). Failure must not break batch creation.
  let assigned = 0;
  if (assignmentMode === "broadcast") {
    try {
      assigned = await assignBroadcastForBatch(batchId);
    } catch (err) {
      console.error("[batches] auto-assign failed:", err);
    }
  }

  return NextResponse.json(
    {
      data: {
        id: batchId,
        name,
        domain,
        articleType,
        totalArticles: successArticles.length,
        errorFiles,
        status: "ready",
        payRatePerArticle,
        assignmentMode,
        broadcastExpiresAt: broadcastExpiresAtMs
          ? new Date(broadcastExpiresAtMs).toISOString()
          : null,
        assigned,
        createdAt: new Date(now).toISOString(),
      },
    },
    { status: 201 }
  );
});
