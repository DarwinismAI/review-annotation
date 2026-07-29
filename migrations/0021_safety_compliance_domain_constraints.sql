-- Allow safety_compliance in legacy domain/sub-domain CHECK constraints.
-- The TypeScript schema already includes these values; this keeps existing
-- Supabase databases aligned before provisioning safety annotators.

ALTER TABLE IF EXISTS "batches" DROP CONSTRAINT IF EXISTS "batches_domain_check";--> statement-breakpoint
ALTER TABLE IF EXISTS "batches" ADD CONSTRAINT "batches_domain_check" CHECK ("domain" IN ('law', 'medical', 'tourism', 'safety_compliance'));--> statement-breakpoint

ALTER TABLE IF EXISTS "expert_profiles" DROP CONSTRAINT IF EXISTS "domain_check";--> statement-breakpoint
ALTER TABLE IF EXISTS "expert_profiles" ADD CONSTRAINT "domain_check" CHECK ("domain" IN ('law', 'medical', 'tourism', 'safety_compliance'));--> statement-breakpoint

ALTER TABLE IF EXISTS "expert_domains" DROP CONSTRAINT IF EXISTS "expert_domains_domain_check";--> statement-breakpoint
ALTER TABLE IF EXISTS "expert_domains" ADD CONSTRAINT "expert_domains_domain_check" CHECK ("domain" IN ('law', 'medical', 'tourism', 'safety_compliance'));--> statement-breakpoint

ALTER TABLE IF EXISTS "expert_sub_domains" DROP CONSTRAINT IF EXISTS "expert_sub_domains_id_check";--> statement-breakpoint
ALTER TABLE IF EXISTS "expert_sub_domains" ADD CONSTRAINT "expert_sub_domains_id_check" CHECK (
  "sub_domain_id" IN (
    'law_01','law_02','law_03','law_04','law_05','law_06','law_07',
    'med_01','med_02','med_03','med_04','med_05','med_06','med_07',
    'trv_01','trv_02','trv_03','trv_04','trv_05','trv_06','trv_07','trv_08',
    'saf_01'
  )
);--> statement-breakpoint

ALTER TABLE IF EXISTS "articles" DROP CONSTRAINT IF EXISTS "articles_sub_domain_id_check";--> statement-breakpoint
ALTER TABLE IF EXISTS "articles" ADD CONSTRAINT "articles_sub_domain_id_check" CHECK (
  "sub_domain_id" IS NULL OR "sub_domain_id" IN (
    'law_01','law_02','law_03','law_04','law_05','law_06','law_07',
    'med_01','med_02','med_03','med_04','med_05','med_06','med_07',
    'trv_01','trv_02','trv_03','trv_04','trv_05','trv_06','trv_07','trv_08',
    'saf_01'
  )
);
