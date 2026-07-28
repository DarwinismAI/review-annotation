ALTER TABLE "articles" ALTER COLUMN "pdf_r2_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "source_format" text DEFAULT 'pdf' NOT NULL;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "source_storage_key" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "payload_json" text;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_source_format_check" CHECK ("articles"."source_format" IN ('pdf', 'json'));