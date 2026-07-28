import { pgTable, text, integer, timestamp, uuid, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { profiles, rubricCriteria } from "./schema";

// ─── E3: Review / Annotation ────────────────────────────────────────────────

/**
 * One review record per (assignment, paragraphId?) pair.
 * paragraphId is null for full-article reviews.
 * FK to assignments and articles are string-typed (no .references()) because
 * those tables live in schema.ts — they are wired at migration time via SQL.
 */
export const reviews = pgTable(
  "reviews",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    /** FK → assignments.id (reference added at migration level) */
    assignmentId: text("assignment_id").notNull(),
    /** FK → articles.id */
    articleId: text("article_id").notNull(),
    expertId: uuid("expert_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    /** null for full-article review; FK → article_paragraphs.id */
    paragraphId: text("paragraph_id"),
    /** "draft" | "completed" | "locked" */
    status: text("status").notNull().default("draft"),
    submittedAt: timestamp("submitted_at"),
    lockedAt: timestamp("locked_at"),
    createdAt: timestamp("created_at").notNull().$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at").notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    check("reviews_status_check", sql`${t.status} IN ('draft', 'completed', 'locked')`),
  ]
);

/**
 * Score for a single rubric criterion within a review.
 * FK to reviews is string-typed.
 */
export const reviewScores = pgTable("review_scores", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  /** FK → reviews.id */
  reviewId: text("review_id").notNull(),
  /** FK → rubric_criteria.id */
  criterionId: text("criterion_id").notNull().references(() => rubricCriteria.id, { onDelete: "restrict" }),
  score: integer("score").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at").notNull().$defaultFn(() => new Date()),
});
