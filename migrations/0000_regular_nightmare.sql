CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_paragraphs" (
	"id" text PRIMARY KEY NOT NULL,
	"article_id" text NOT NULL,
	"paragraph_index" integer NOT NULL,
	"text" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"pdf_r2_key" text NOT NULL,
	"text_content" text,
	"status" text DEFAULT 'unassigned' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "articles_type_check" CHECK ("articles"."type" IN ('full', 'paragraph')),
	CONSTRAINT "articles_status_check" CHECK ("articles"."status" IN ('unassigned', 'assigned', 'in_review', 'completed'))
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"article_id" text NOT NULL,
	"expert_id" text NOT NULL,
	"pay_rate" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'assigned' NOT NULL,
	"assigned_at" bigint NOT NULL,
	"completed_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "assignments_status_check" CHECK ("assignments"."status" IN ('assigned', 'in_review', 'completed'))
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"article_type" text NOT NULL,
	"zip_r2_key" text NOT NULL,
	"total_articles" integer DEFAULT 0 NOT NULL,
	"error_files" text,
	"pay_rate_per_article" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "batches_domain_check" CHECK ("batches"."domain" IN ('law', 'medical')),
	CONSTRAINT "batches_type_check" CHECK ("batches"."article_type" IN ('full', 'paragraph')),
	CONSTRAINT "batches_status_check" CHECK ("batches"."status" IN ('ready', 'in_progress', 'completed'))
);
--> statement-breakpoint
CREATE TABLE "expert_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"domain" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invite_token" text,
	"invite_expires_at" bigint,
	"invited_at" bigint NOT NULL,
	"activated_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "expert_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "expert_profiles_invite_token_unique" UNIQUE("invite_token"),
	CONSTRAINT "domain_check" CHECK ("expert_profiles"."domain" IN ('law', 'medical')),
	CONSTRAINT "status_check" CHECK ("expert_profiles"."status" IN ('pending', 'active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "rubric_criteria" (
	"id" text PRIMARY KEY NOT NULL,
	"rubric_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"scale" text NOT NULL,
	"required" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubrics" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text,
	"role" text DEFAULT 'expert' NOT NULL,
	"image" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "role_check" CHECK ("user"."role" IN ('admin', 'expert'))
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "review_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"criterion_id" text NOT NULL,
	"score" integer NOT NULL,
	"reason" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"assignment_id" text NOT NULL,
	"article_id" text NOT NULL,
	"expert_id" text NOT NULL,
	"paragraph_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp,
	"locked_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "reviews_status_check" CHECK ("reviews"."status" IN ('draft', 'completed', 'locked'))
);
--> statement-breakpoint
CREATE TABLE "time_events" (
	"id" text PRIMARY KEY NOT NULL,
	"assignment_id" text NOT NULL,
	"article_id" text NOT NULL,
	"expert_id" text NOT NULL,
	"paragraph_id" text,
	"event_type" text NOT NULL,
	"timestamp" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "time_events_type_check" CHECK ("time_events"."event_type" IN ('reading_start', 'reading_pause', 'scoring_start', 'scoring_pause', 'tab_hidden', 'tab_visible'))
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_paragraphs" ADD CONSTRAINT "article_paragraphs_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_expert_id_user_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_profiles" ADD CONSTRAINT "expert_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_criteria" ADD CONSTRAINT "rubric_criteria_rubric_id_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubrics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_expert_id_user_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_events" ADD CONSTRAINT "time_events_expert_id_user_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;