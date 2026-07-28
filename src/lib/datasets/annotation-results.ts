import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import { annotationResults } from "@/db/datasets";

export async function saveAnnotationResults(input: {
  tx: any;
  assignmentId: string;
  rowId: string;
  annotatorId: string;
  metricIds: string[];
  values: Record<string, string | null | undefined>;
  notes?: Record<string, string | null | undefined>;
  mode: "draft" | "completed";
  now: Date;
}) {
  for (const metricId of input.metricIds) {
    const value = input.values[metricId] || null;
    const note = input.notes?.[metricId] ?? null;
    if (input.mode === "draft" && value === null && (note === null || note === "")) continue;

    const existing = (
      await input.tx
        .select({ id: annotationResults.id })
        .from(annotationResults)
        .where(and(eq(annotationResults.assignmentId, input.assignmentId), eq(annotationResults.metricId, metricId)))
    )[0];

    const payload = {
      value: value ?? (input.mode === "draft" ? "" : null),
      note,
      submittedAt: input.now,
      updatedAt: input.now,
    };

    if (existing) {
      await input.tx.update(annotationResults).set(payload).where(eq(annotationResults.id, existing.id));
    } else {
      await input.tx.insert(annotationResults).values({
        id: createId(),
        assignmentId: input.assignmentId,
        rowId: input.rowId,
        annotatorId: input.annotatorId,
        metricId,
        ...payload,
      });
    }
  }
}
