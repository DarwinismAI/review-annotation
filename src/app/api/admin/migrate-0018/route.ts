/**
 * TEMPORARY — apply migration 0018 (annotator roles + annotation drafts).
 * DELETE THIS FILE after running once on dev/prod.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-middleware";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const POST = requireAdmin(async () => {
  try {
    await db.execute(sql`ALTER TABLE "profiles" DROP CONSTRAINT IF EXISTS "profiles_role_check"`);
    await db.execute(sql`UPDATE "profiles" SET "role" = 'annotator' WHERE "role" = 'expert'`);
    await db.execute(sql`ALTER TABLE "profiles" ALTER COLUMN "role" SET DEFAULT 'annotator'`);
    await db.execute(sql`
      ALTER TABLE "profiles"
      ADD CONSTRAINT "profiles_role_check"
      CHECK ("role" IN ('superadmin', 'admin', 'annotator'))
    `);

    await db.execute(sql`
      CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
      RETURNS TRIGGER AS $$
      DECLARE
        requested_role TEXT;
      BEGIN
        requested_role := COALESCE(NEW.raw_user_meta_data->>'role', 'annotator');
        IF requested_role = 'expert' THEN
          requested_role := 'annotator';
        END IF;
        IF requested_role NOT IN ('superadmin', 'admin', 'annotator') THEN
          requested_role := 'annotator';
        END IF;

        INSERT INTO public.profiles (id, email, role)
        VALUES (NEW.id, NEW.email, requested_role)
        ON CONFLICT (id) DO NOTHING;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER
    `);

    await db.execute(sql`ALTER TABLE "annotation_results" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'completed'`);
    await db.execute(sql`ALTER TABLE "annotation_results" ALTER COLUMN "value" DROP NOT NULL`);
    await db.execute(sql`ALTER TABLE "annotation_results" DROP CONSTRAINT IF EXISTS "annotation_results_status_check"`);
    await db.execute(sql`
      ALTER TABLE "annotation_results"
      ADD CONSTRAINT "annotation_results_status_check"
      CHECK ("status" IN ('draft', 'completed'))
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "annotation_results_assignment_status_idx"
      ON "annotation_results" ("assignment_id", "status")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "annotation_results_row_metric_status_idx"
      ON "annotation_results" ("row_id", "metric_id", "status")
    `);

    return NextResponse.json({ ok: true, message: "Migration 0018 applied — annotator roles and annotation drafts ready" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
});
