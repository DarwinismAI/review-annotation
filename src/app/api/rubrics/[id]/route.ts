import { NextRequest, NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { and, eq, gte, inArray, type ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { db } from "@/db/client";
import { articles, assignments, batches, rubricCriteria, rubrics } from "@/db/schema";
import { reviewScores } from "@/db/reviews";
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
type RubricCriterionId = Pick<typeof rubricCriteria.$inferSelect, "id">;

function metricInUseResponse() {
  return NextResponse.json(
    {
      error: {
        code: "METRIC_IN_USE",
        message: "Metric đã được áp dụng và không thể thay đổi hoặc xóa",
      },
    },
    { status: 409 },
  );
}

function isReviewScoreCriterionConstraint(error: unknown) {
  if (!error || typeof error !== "object") return false;

  const databaseError = error as { code?: string; constraint_name?: string };
  return databaseError.code === "23503"
    && databaseError.constraint_name === "review_scores_criterion_id_rubric_criteria_id_fk";
}

function normalizeMetricInput(body: MetricBody) {
  const metric = Array.isArray(body.scale)
    ? body
    : Array.isArray(body.criteria) && body.criteria.length === 1
      ? body.criteria[0]
      : null;

  if (!metric) {
    return { ok: false as const, message: "Mỗi metric chỉ có một cấu hình thông số" };
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

/** GET /api/rubrics/:id - fetch one metric */
export const GET = requireAdmin(async (_req: NextRequest, _session, context) => {
  const id = context?.params?.id;
  if (!id) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Thiếu ID metric" } }, { status: 400 });
  }

  const [rubric] = await db.select().from(rubrics).where(eq(rubrics.id, id));
  if (!rubric) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Không tìm thấy metric" } }, { status: 404 });
  }

  const [criterion] = await db
    .select()
    .from(rubricCriteria)
    .where(eq(rubricCriteria.rubricId, id))
    .orderBy(rubricCriteria.sortOrder);

  return NextResponse.json({
    data: toMetricResponse(rubric, criterion ?? null),
  });
});

/** PATCH /api/rubrics/:id - update one metric */
export const PATCH = requireAdmin(async (req: NextRequest, _session, context) => {
  const id = context?.params?.id;
  if (!id) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Thiếu ID metric" } }, { status: 400 });
  }

  let body: MetricBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Dữ liệu không hợp lệ" } }, { status: 400 });
  }

  const [rubric] = await db.select().from(rubrics).where(eq(rubrics.id, id));
  if (!rubric) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Không tìm thấy metric" } }, { status: 404 });
  }

  if (body.domain && !isDomainKey(body.domain)) {
    return NextResponse.json({ error: { code: "INVALID_DOMAIN", message: "Lĩnh vực không hợp lệ" } }, { status: 400 });
  }

  let normalized = null;

  if (Array.isArray(body.scale) || Array.isArray(body.criteria)) {
    normalized = normalizeMetricInput(body);
    if (!normalized.ok) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: normalized.message } }, { status: 400 });
    }
  }

  const applicableDomains = body.domain && body.domain !== rubric.domain
    ? [rubric.domain, body.domain]
    : [rubric.domain];
  const now = Date.now();
  const updated = await db.transaction(async (tx: RubricTransaction) => {
    const [applicableAssignment] = await tx
      .select({ id: assignments.id })
      .from(assignments)
      .innerJoin(articles, eq(assignments.articleId, articles.id))
      .innerJoin(batches, eq(articles.batchId, batches.id))
      .where(
        and(
          inArray(batches.domain, applicableDomains),
          gte(assignments.createdAt, rubric.createdAt),
        ),
      )
      .limit(1);

    if (applicableAssignment) {
      return false;
    }

    const [existingCriterion] = await tx
      .select()
      .from(rubricCriteria)
      .where(eq(rubricCriteria.rubricId, id))
      .orderBy(rubricCriteria.sortOrder);
    const metricName = normalized?.ok
      ? normalized.metric.name
      : body.name?.trim() || rubric.name;

    await tx
      .update(rubrics)
      .set({
        name: metricName,
        domain: body.domain ?? rubric.domain,
        updatedAt: now,
      })
      .where(eq(rubrics.id, id));

    if (normalized?.ok) {
      const criterionValues = {
        name: metricName,
        description: normalized.metric.description || null,
        scale: JSON.stringify(normalized.metric.scale),
        required: normalized.metric.required !== false ? 1 : 0,
        sortOrder: 0,
        updatedAt: now,
      };

      if (existingCriterion) {
        await tx
          .update(rubricCriteria)
          .set(criterionValues)
          .where(eq(rubricCriteria.id, existingCriterion.id));
      } else {
        await tx.insert(rubricCriteria).values({
          id: createId(),
          rubricId: id,
          ...criterionValues,
          createdAt: now,
        });
      }
    } else if (body.name?.trim() && existingCriterion) {
      await tx
        .update(rubricCriteria)
        .set({ name: metricName, updatedAt: now })
        .where(eq(rubricCriteria.id, existingCriterion.id));
    }

    return true;
  }, { isolationLevel: "serializable" });

  if (!updated) {
    return metricInUseResponse();
  }

  const [criterion] = await db
    .select()
    .from(rubricCriteria)
    .where(eq(rubricCriteria.rubricId, id))
    .orderBy(rubricCriteria.sortOrder);

  return NextResponse.json({
    data: toMetricResponse(
      {
        ...rubric,
        name: normalized?.ok ? normalized.metric.name : body.name?.trim() || rubric.name,
        domain: body.domain ?? rubric.domain,
        updatedAt: now,
      },
      criterion ?? null,
    ),
  });
});

/** DELETE /api/rubrics/:id - delete one metric */
export const DELETE = requireAdmin(async (_req: NextRequest, _session, context) => {
  const id = context?.params?.id;
  if (!id) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Thiếu ID metric" } }, { status: 400 });
  }

  const [rubric] = await db.select({ id: rubrics.id }).from(rubrics).where(eq(rubrics.id, id));
  if (!rubric) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Không tìm thấy metric" } }, { status: 404 });
  }

  const criteria = await db
    .select({ id: rubricCriteria.id })
    .from(rubricCriteria)
    .where(eq(rubricCriteria.rubricId, id));

  if (criteria.length > 0) {
    const [referencedScore] = await db
      .select({ id: reviewScores.id })
      .from(reviewScores)
      .where(inArray(reviewScores.criterionId, criteria.map((criterion: RubricCriterionId) => criterion.id)))
      .limit(1);

    if (referencedScore) {
      return metricInUseResponse();
    }
  }

  try {
    await db.transaction(async (tx: RubricTransaction) => {
      await tx.delete(rubricCriteria).where(eq(rubricCriteria.rubricId, id));
      await tx.delete(rubrics).where(eq(rubrics.id, id));
    });
  } catch (error) {
    if (isReviewScoreCriterionConstraint(error)) {
      return metricInUseResponse();
    }
    throw error;
  }

  return NextResponse.json({ data: { id } });
});
