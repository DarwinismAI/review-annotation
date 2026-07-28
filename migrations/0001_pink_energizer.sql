CREATE TABLE "article_segments" (
	"id" text PRIMARY KEY NOT NULL,
	"article_id" text NOT NULL,
	"order" integer NOT NULL,
	"text" text NOT NULL,
	"color" text NOT NULL,
	"type" text NOT NULL,
	"score_value" real,
	"page_index" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "seg_color_check" CHECK ("article_segments"."color" IN ('green','yellow','red','neutral')),
	CONSTRAINT "seg_type_check" CHECK ("article_segments"."type" IN ('highlight','badge','warning','score','text'))
);
--> statement-breakpoint
ALTER TABLE "article_segments" ADD CONSTRAINT "article_segments_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "article_segments_article_idx" ON "article_segments" ("article_id","order");