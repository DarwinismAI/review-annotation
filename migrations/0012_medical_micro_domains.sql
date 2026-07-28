-- 0012_medical_micro_domains.sql
-- Add medical-only micro-domain routing below existing med_* sub-domains.
-- Source: ingested JSON payload field `medical_micro_domain_id` (also accepts aliases in API code).
-- Nullable for non-medical, legacy, PDF, or unclassified rows.
--
-- Expert semantics mirror expert_sub_domains:
-- - no expert_medical_micro_domains rows under a selected med_* sub-domain => any micro-domain there
-- - one or more rows under that med_* sub-domain => exact micro-domain match required
--
-- Rollback:
--   DROP TABLE IF EXISTS "expert_medical_micro_domains";
--   ALTER TABLE "articles" DROP COLUMN IF EXISTS "medical_micro_domain_id";

CREATE TABLE IF NOT EXISTS "expert_medical_micro_domains" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "micro_domain_id" text NOT NULL,
  "created_at" bigint NOT NULL,
  CONSTRAINT "expert_medical_micro_domains_id_check" CHECK ("micro_domain_id" LIKE 'med\_%\_%' ESCAPE '\'),
  CONSTRAINT "expert_medical_micro_domains_user_micro_unique" UNIQUE ("user_id", "micro_domain_id")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "expert_medical_micro_domains_user_idx" ON "expert_medical_micro_domains" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expert_medical_micro_domains_micro_idx" ON "expert_medical_micro_domains" ("micro_domain_id");--> statement-breakpoint

ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "medical_micro_domain_id" text;--> statement-breakpoint
ALTER TABLE "articles" DROP CONSTRAINT IF EXISTS "articles_medical_micro_domain_id_check";--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_medical_micro_domain_id_check" CHECK (
  "medical_micro_domain_id" IS NULL OR "medical_micro_domain_id" LIKE 'med\_%\_%' ESCAPE '\'
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "articles_medical_micro_domain_idx" ON "articles" ("medical_micro_domain_id");
