/**
 * TEMPORARY — apply migration 0012 (medical micro-domain routing).
 * DELETE THIS FILE after running once.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-middleware";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const POST = requireAdmin(async () => {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "expert_medical_micro_domains" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
        "micro_domain_id" text NOT NULL,
        "created_at" bigint NOT NULL,
        CONSTRAINT "expert_medical_micro_domains_id_check" CHECK ("micro_domain_id" LIKE 'med\\_%\\_%' ESCAPE '\\'),
        CONSTRAINT "expert_medical_micro_domains_user_micro_unique" UNIQUE ("user_id", "micro_domain_id")
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "expert_medical_micro_domains_user_idx" ON "expert_medical_micro_domains" ("user_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "expert_medical_micro_domains_micro_idx" ON "expert_medical_micro_domains" ("micro_domain_id")`);

    await db.execute(sql`ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "medical_micro_domain_id" text`);
    await db.execute(sql`ALTER TABLE "articles" DROP CONSTRAINT IF EXISTS "articles_medical_micro_domain_id_check"`);
    await db.execute(sql`
      ALTER TABLE "articles" ADD CONSTRAINT "articles_medical_micro_domain_id_check" CHECK (
        "medical_micro_domain_id" IS NULL OR "medical_micro_domain_id" LIKE 'med\\_%\\_%' ESCAPE '\\'
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "articles_medical_micro_domain_idx" ON "articles" ("medical_micro_domain_id")`);

    return NextResponse.json({ ok: true, message: "Migration 0012 applied — medical micro-domain routing ready" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
});
