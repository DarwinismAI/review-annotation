// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import { rubrics, rubricCriteria } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { isDomainKey } from "@/lib/labels";

interface ScaleItem {
  score: number;
  label: string;
  description: string;
}

interface CriterionInput {
  name: string;
  description?: string;
  scale: ScaleItem[];
  required?: boolean;
}

/** GET /api/rubrics — list rubrics with criteria */
export const GET = requireAdmin(async (req) => {
  const { searchParams } = new URL(req.url);
  const domain = searchParams.get("domain");

  const rubricRows = await db
    .select()
    .from(rubrics)
    .where(domain ? eq(rubrics.domain, domain) : undefined)
    .orderBy(rubrics.createdAt);

  const result = await Promise.all(
    rubricRows.map(async (rubric) => {
      const criteria = await db
        .select()
        .from(rubricCriteria)
        .where(eq(rubricCriteria.rubricId, rubric.id))
        .orderBy(rubricCriteria.sortOrder);

      return {
        ...rubric,
        criteria: criteria.map((c) => ({
          ...c,
          scale: JSON.parse(c.scale) as ScaleItem[],
          required: Boolean(c.required),
        })),
      };
    })
  );

  return NextResponse.json({ data: result });
});

/** POST /api/rubrics — create a new rubric */
export const POST = requireAdmin(async (req, session) => {
  let body: { name?: string; domain?: string; criteria?: CriterionInput[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Dữ liệu không hợp lệ" } },
      { status: 400 }
    );
  }

  const { name, domain, criteria = [] } = body;

  if (!name || !domain) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Thiếu tên hoặc lĩnh vực rubric" } },
      { status: 400 }
    );
  }

  if (!isDomainKey(domain)) {
    return NextResponse.json(
      { error: { code: "INVALID_DOMAIN", message: "Lĩnh vực không hợp lệ" } },
      { status: 400 }
    );
  }

  // Validate scale completeness
  for (const criterion of criteria) {
    for (const item of criterion.scale ?? []) {
      if (!item.description?.trim()) {
        return NextResponse.json(
          {
            error: {
              code: "INCOMPLETE_SCALE",
              message: `Tiêu chí "${criterion.name}" thiếu mô tả cho mức điểm ${item.score}`,
            },
          },
          { status: 400 }
        );
      }
    }
  }

  const now = Date.now();
  const rubricId = createId();

  await db.insert(rubrics).values({
    id: rubricId,
    name,
    domain,
    createdBy: session.user.id,
    createdAt: now,
    updatedAt: now,
  });

  const criteriaRows = criteria.map((c, idx) => ({
    id: createId(),
    rubricId,
    name: c.name,
    description: c.description ?? null,
    scale: JSON.stringify(c.scale),
    required: c.required !== false ? 1 : 0,
    sortOrder: idx,
    createdAt: now,
    updatedAt: now,
  }));

  if (criteriaRows.length > 0) {
    await db.insert(rubricCriteria).values(criteriaRows);
  }

  const created = await db
    .select()
    .from(rubricCriteria)
    .where(eq(rubricCriteria.rubricId, rubricId))
    .orderBy(rubricCriteria.sortOrder);

  return NextResponse.json(
    {
      data: {
        id: rubricId,
        name,
        domain,
        createdAt: now,
        updatedAt: now,
        criteria: created.map((c) => ({
          ...c,
          scale: JSON.parse(c.scale) as ScaleItem[],
          required: Boolean(c.required),
        })),
      },
    },
    { status: 201 }
  );
});
