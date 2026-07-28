-- 0010_expert_sub_domains.sql
-- Multi sub-domain preferences for experts. Optional per main domain.
-- Empty set for a given domain means "any sub-domain of that domain" (no filter).
--
-- Allowed IDs match taxonomy in seed_data/[Vivipedia] Dataset_Definition_Final.csv:
--   law_01..law_07   (Dân sự, Hình sự, Hành chính, Đất đai, DN&TM, Lao động, SHTT)
--   med_01..med_07   (Nội, Ngoại, Dược, Dinh dưỡng, YTCC, Tâm thần, Nhi)
--   trv_01..trv_08   (Điểm đến, Ẩm thực, Lưu trú, Tour, Di chuyển, Visa, Sinh thái, Lễ hội)
--
-- Forward-only — no data backfill (existing experts default to "any sub-domain of their domains").
-- Rollback: DROP TABLE "expert_sub_domains";

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
);--> statement-breakpoint

ALTER TABLE "expert_sub_domains"
  ADD CONSTRAINT "expert_sub_domains_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "expert_sub_domains_user_idx" ON "expert_sub_domains" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expert_sub_domains_sub_idx"  ON "expert_sub_domains" ("sub_domain_id");
