import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2";
import { profiles, rubricCriteria } from "./schema.sqlite";

export const reviews = sqliteTable("reviews", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  assignmentId: text("assignment_id").notNull(),
  articleId: text("article_id").notNull(),
  expertId: text("expert_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  paragraphId: text("paragraph_id"),
  status: text("status", { enum: ["draft", "completed", "locked"] }).notNull().default("draft"),
  submittedAt: text("submitted_at"),
  lockedAt: text("locked_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const reviewScores = sqliteTable("review_scores", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  reviewId: text("review_id").notNull(),
  criterionId: text("criterion_id").notNull().references(() => rubricCriteria.id, { onDelete: "restrict" }),
  score: integer("score").notNull(),
  reason: text("reason"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});
