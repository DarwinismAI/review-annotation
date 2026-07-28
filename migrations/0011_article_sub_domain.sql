-- 0011_article_sub_domain.sql
-- Add optional sub-domain classification on each article.
-- Source: ingested JSON payload field `sub_domain_id`. Nullable for legacy / PDF-sourced rows.
--
-- Allowed IDs match the taxonomy used by expert_sub_domains (see 0010_expert_sub_domains.sql).
-- Used by broadcast filter in lib/auto-assign.ts — if expert has any sub_domain for the
-- article's parent domain, narrow assignments to matching IDs; otherwise no narrowing.
--
-- Forward-only. No data backfill (production DB will be reset before next batch import).
-- Rollback: ALTER TABLE "articles" DROP COLUMN "sub_domain_id";

ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "sub_domain_id" text;--> statement-breakpoint

ALTER TABLE "articles" DROP CONSTRAINT IF EXISTS "articles_sub_domain_id_check";--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_sub_domain_id_check" CHECK (
  "sub_domain_id" IS NULL OR "sub_domain_id" IN (
    'law_01','law_02','law_03','law_04','law_05','law_06','law_07',
    'med_01','med_02','med_03','med_04','med_05','med_06','med_07',
    'trv_01','trv_02','trv_03','trv_04','trv_05','trv_06','trv_07','trv_08'
  )
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "articles_sub_domain_idx" ON "articles" ("sub_domain_id");
