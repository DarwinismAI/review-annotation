/**
 * TEMPORARY — apply migration 0011 (add articles.sub_domain_id).
 * DELETE THIS FILE after running once.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-middleware";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const POST = requireAdmin(async () => {
  try {
    await db.execute(sql`ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "sub_domain_id" text`);

    await db.execute(sql`ALTER TABLE "articles" DROP CONSTRAINT IF EXISTS "articles_sub_domain_id_check"`);
    await db.execute(sql`
      ALTER TABLE "articles" ADD CONSTRAINT "articles_sub_domain_id_check" CHECK (
        "sub_domain_id" IS NULL OR "sub_domain_id" IN (
          'law_01','law_02','law_03','law_04','law_05','law_06','law_07',
          'med_01','med_02','med_03','med_04','med_05','med_06','med_07',
          'trv_01','trv_02','trv_03','trv_04','trv_05','trv_06','trv_07','trv_08'
        )
      )
    `);

    await db.execute(sql`CREATE INDEX IF NOT EXISTS "articles_sub_domain_idx" ON "articles" ("sub_domain_id")`);

    return NextResponse.json({ ok: true, message: "Migration 0011 applied — articles.sub_domain_id ready" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
});
