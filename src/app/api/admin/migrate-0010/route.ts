/**
 * TEMPORARY — apply migration 0010 (expert_sub_domains table).
 * DELETE THIS FILE after running once. Pattern mirrors prior temp migration endpoints.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-middleware";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const POST = requireAdmin(async () => {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "expert_sub_domains" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" uuid NOT NULL,
        "sub_domain_id" text NOT NULL,
        "created_at" bigint NOT NULL,
        CONSTRAINT "expert_sub_domains_id_check" CHECK ("sub_domain_id" IN (
          'law_01','law_02','law_03','law_04','law_05','law_06','law_07',
          'med_01','med_02','med_03','med_04','med_05','med_06','med_07',
          'trv_01','trv_02','trv_03','trv_04','trv_05','trv_06','trv_07','trv_08'
        )),
        CONSTRAINT "expert_sub_domains_user_sub_unique" UNIQUE ("user_id", "sub_domain_id")
      )
    `);

    // FK is added separately so re-runs don't fail if the constraint name already exists.
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'expert_sub_domains_user_id_fk'
        ) THEN
          ALTER TABLE "expert_sub_domains"
            ADD CONSTRAINT "expert_sub_domains_user_id_fk"
            FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION;
        END IF;
      END$$;
    `);

    await db.execute(sql`CREATE INDEX IF NOT EXISTS "expert_sub_domains_user_idx" ON "expert_sub_domains" ("user_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "expert_sub_domains_sub_idx"  ON "expert_sub_domains" ("sub_domain_id")`);

    return NextResponse.json({ ok: true, message: "Migration 0010 applied — expert_sub_domains ready" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
});
