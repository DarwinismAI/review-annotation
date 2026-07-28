-- 0008_add_tourism_domain.sql
-- Widen domain CHECK constraints to allow 'tourism' alongside 'law' and 'medical'.
-- Forward-only — no data backfill.
-- Rollback: DROP each new constraint and re-create with ('law', 'medical').

ALTER TABLE "batches" DROP CONSTRAINT IF EXISTS "batches_domain_check";--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_domain_check" CHECK ("batches"."domain" IN ('law', 'medical', 'tourism'));--> statement-breakpoint

ALTER TABLE "expert_profiles" DROP CONSTRAINT IF EXISTS "domain_check";--> statement-breakpoint
ALTER TABLE "expert_profiles" ADD CONSTRAINT "domain_check" CHECK ("expert_profiles"."domain" IN ('law', 'medical', 'tourism'));--> statement-breakpoint

ALTER TABLE "expert_domains" DROP CONSTRAINT IF EXISTS "expert_domains_domain_check";--> statement-breakpoint
ALTER TABLE "expert_domains" ADD CONSTRAINT "expert_domains_domain_check" CHECK ("domain" IN ('law', 'medical', 'tourism'));
