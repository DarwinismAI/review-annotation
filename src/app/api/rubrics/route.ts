import { NextRequest, NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { asc, eq, type ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { db } from "@/db/client";
import { rubricCriteria, rubrics } from "@/db/schema";
import { requireAdmin } from "@/lib/auth-middleware";
import { isDomainKey } from "@/lib/labels";
import { toMetricResponse } from "@/lib/rubric-metric-adapter";

interface ScaleItem {
  score: number;
  label: string;
  description: string;
}

interface MetricInput {
  name: string;
  description?: string;
  scale: ScaleItem[];
  required?: boolean;
}

interface MetricBody extends Partial<MetricInput> {
  domain?: string;
  criteria?: MetricInput[];
}

type RubricTransaction = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
type Rubric = typeof rubrics.$inferSelect;

function normalizeMetricInput(body: MetricBody) {
  const metric = Array.isArray(body.scale)
    ? body
    : Array.isArray(body.criteria) && body.criteria.length === 1
      ? body.criteria[0]
      : null;

  if (!metric) {
    return { ok: false as const, message: "Mỗi lần chỉ tạo một metric" };
  }
  if (!metric.name?.trim() || !Array.isArray(metric.scale) || metric.scale.length < 2) {
    return { ok: false as const, message: "Metric cần tên và ít nhất 2 mức chấm" };
  }

  for (const item of metric.scale) {
    if (!item.label?.trim() || !item.description?.trim()) {
      return { ok: false as const, message: `Metric "${metric.name}" thiếu label hoặc mô tả cho mức ${item.score}` };
    }
  }

  return {
    ok: true as const,
    metric: {
      ...metric,
      name: metric.name.trim(),
      description: metric.description?.trim() ?? "",
      scale: metric.scale.map((item, index) => ({
        score: index + 1,
        label: item.label.trim(),
        description: item.description.trim(),
      })),
    },
  };
}

/** GET /api/rubrics - list metrics with their single internal criterion */
export const GET = requireAdmin(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const domain = searchParams.get("domain");

  const rubricRows = await db
    .select()
    .from(rubrics)
    .where(domain ? eq(rubrics.domain, domain) : undefined)
    .orderBy(asc(rubrics.createdAt), asc(rubrics.id));

  const result = await Promise.all(
    rubricRows.map(async (rubric: Rubric) => {
      const [criterion] = await db
        .select()
        .from(rubricCriteria)
        .where(eq(rubricCriteria.rubricId, rubric.id))
        .orderBy(rubricCriteria.sortOrder);

      return toMetricResponse(rubric, criterion ?? null);
    }),
  );

  return NextResponse.json({ data: result });
});

/** POST /api/rubrics - create one metric */
export const POST = requireAdmin(async (req: NextRequest, session) => {
  let body: MetricBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Dữ liệu không hợp lệ" } }, { status: 400 });
  }

  const { name, domain } = body;
  if (!name?.trim() || !domain) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Thiếu tên metric hoặc lĩnh vực" } }, { status: 400 });
  }
  if (!isDomainKey(domain)) {
    return NextResponse.json({ error: { code: "INVALID_DOMAIN", message: "Lĩnh vực không hợp lệ" } }, { status: 400 });
  }

  const normalized = normalizeMetricInput(body);
  if (!normalized.ok) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: normalized.message } }, { status: 400 });
  }

  const now = Date.now();
  const rubricId = createId();
  const criterionId = createId();

  await db.transaction(async (tx: RubricTransaction) => {
    await tx.insert(rubrics).values({
      id: rubricId,
      name: normalized.metric.name,
      domain,
      createdBy: session.user.id,
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(rubricCriteria).values({
      id: criterionId,
      rubricId,
      name: normalized.metric.name,
      description: normalized.metric.description || null,
      scale: JSON.stringify(normalized.metric.scale),
      required: normalized.metric.required !== false ? 1 : 0,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    });
  });

  return NextResponse.json(
    {
      data: {
        id: rubricId,
        name: normalized.metric.name,
        domain,
        criterionId,
        description: normalized.metric.description,
        scale: normalized.metric.scale,
        required: normalized.metric.required !== false,
        createdAt: now,
        updatedAt: now,
      },
    },
    { status: 201 },
  );
});
