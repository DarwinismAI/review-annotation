import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAnnotator } from "@/lib/auth-middleware";
import { db } from "@/lib/db";
import { compensationSurveyResponses } from "@/db/compensation-survey";
import { createId } from "@paralleldrive/cuid2";

const bodySchema = z.object({
  expectedRate: z.string().trim().min(1).max(200),
  unit: z.enum(["per_article", "per_hour"]),
});

export const POST = requireAnnotator(async (req, session) => {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Dữ liệu không hợp lệ" } },
      { status: 400 }
    );
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "UNPROCESSABLE_ENTITY", message: parsed.error.issues[0]?.message ?? "Invalid" } },
      { status: 422 }
    );
  }

  try {
    await db.insert(compensationSurveyResponses).values({
      id: createId(),
      expertId: session.user.id,
      expectedRate: parsed.data.expectedRate,
      unit: parsed.data.unit,
    });
  } catch (e: unknown) {
    // UNIQUE violation = already submitted — treat as success (idempotent).
    // SQLite via libsql: Drizzle wraps the error; violation lives in e.cause.
    // PG via postgres-js: violation is on e directly with code "23505".
    const err = e as { code?: string; cause?: { code?: string; message?: string }; message?: string };
    const code = err?.code;
    const causeCode = err?.cause?.code;
    const causeMsg = String(err?.cause?.message ?? "");
    const isUnique =
      code === "23505" ||
      causeCode === "SQLITE_CONSTRAINT" ||
      /unique/i.test(causeMsg);
    if (!isUnique) throw e;
  }

  return NextResponse.json({ data: { ok: true } }, { status: 201 });
});
