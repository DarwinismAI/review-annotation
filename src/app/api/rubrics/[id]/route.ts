// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import { rubrics, rubricCriteria } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

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

/** PATCH /api/rubrics/:id — update rubric name and/or criteria */
export const PATCH = requireAdmin(async (req, _session, context) => {
  const id = context?.params?.id;
  if (!id) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Thiếu ID rubric" } },
      { status: 400 }
    );
  }

  let body: { name?: string; criteria?: CriterionInput[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Dữ liệu không hợp lệ" } },
      { status: 400 }
    );
  }

  const [rubric] = await db
    .select()
    .from(rubrics)
    .where(eq(rubrics.id, id));

  if (!rubric) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Không tìm thấy rubric" } },
      { status: 404 }
    );
  }

  const now = Date.now();
  const updates: Partial<typeof rubrics.$inferInsert> = { updatedAt: now };
  if (body.name) updates.name = body.name;

  await db.update(rubrics).set(updates).where(eq(rubrics.id, id));

  // Replace criteria if provided
  if (Array.isArray(body.criteria)) {
    // Validate scale completeness
    for (const criterion of body.criteria) {
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

    // Delete existing criteria and re-insert (simple replace strategy)
    await db.delete(rubricCriteria).where(eq(rubricCriteria.rubricId, id));

    if (body.criteria.length > 0) {
      await db.insert(rubricCriteria).values(
        body.criteria.map((c, idx) => ({
          id: createId(),
          rubricId: id,
          name: c.name,
          description: c.description ?? null,
          scale: JSON.stringify(c.scale),
          required: c.required !== false ? 1 : 0,
          sortOrder: idx,
          createdAt: now,
          updatedAt: now,
        }))
      );
    }
  }

  const criteria = await db
    .select()
    .from(rubricCriteria)
    .where(eq(rubricCriteria.rubricId, id))
    .orderBy(rubricCriteria.sortOrder);

  return NextResponse.json({
    data: {
      id,
      name: body.name ?? rubric.name,
      domain: rubric.domain,
      updatedAt: now,
      criteria: criteria.map((c) => ({
        ...c,
        scale: JSON.parse(c.scale) as ScaleItem[],
        required: Boolean(c.required),
      })),
    },
  });
});
