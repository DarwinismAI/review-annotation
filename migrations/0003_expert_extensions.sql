-- E1-ext + E2-ext extension migration
-- Adds: assignment_mode + broadcast_expires_at on batches, enabled + disabled_at on articles,
-- expert_domains join table for multi-domain experts.
-- Backfills expert_domains from existing expert_profiles.domain.

ALTER TABLE "batches" ADD COLUMN "assignment_mode" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "broadcast_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_assignment_mode_check" CHECK ("batches"."assignment_mode" IN ('manual', 'broadcast'));--> statement-breakpoint

ALTER TABLE "articles" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "disabled_at" timestamp;--> statement-breakpoint

CREATE TABLE "expert_domains" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "domain" text NOT NULL,
  "created_at" bigint NOT NULL,
  CONSTRAINT "expert_domains_domain_check" CHECK ("domain" IN ('law', 'medical')),
  CONSTRAINT "expert_domains_user_domain_unique" UNIQUE ("user_id", "domain")
);--> statement-breakpoint

ALTER TABLE "expert_domains" ADD CONSTRAINT "expert_domains_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expert_domains_user_idx" ON "expert_domains" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expert_domains_domain_idx" ON "expert_domains" ("domain");--> statement-breakpoint

-- Backfill: every existing expert_profiles row → matching expert_domains row.
INSERT INTO "expert_domains" ("id", "user_id", "domain", "created_at")
SELECT
  encode(gen_random_bytes(12), 'hex'),
  ep.user_id,
  ep.domain,
  COALESCE(ep.activated_at, ep.invited_at, EXTRACT(EPOCH FROM now())::bigint * 1000)
FROM "expert_profiles" ep
ON CONFLICT ("user_id", "domain") DO NOTHING;
--> statement-breakpoint

-- Race-safe broadcast claim — at most ONE assignment per article.
-- Concurrent POST /api/articles/:id/claim collapses to one winner via constraint.
CREATE UNIQUE INDEX IF NOT EXISTS "assignments_article_id_unique" ON "assignments" ("article_id");
