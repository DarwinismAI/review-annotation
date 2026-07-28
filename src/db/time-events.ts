import { pgTable, text, timestamp, uuid, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { profiles } from "./schema";

// ─── E3: Time Tracking Events ───────────────────────────────────────────────

/**
 * Client-side time events batched and sent every 30s or on page unload.
 * FK to assignments and articles are string-typed (cross-file; wired at migration level).
 */
export const timeEvents = pgTable(
  "time_events",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    /** FK → assignments.id */
    assignmentId: text("assignment_id").notNull(),
    /** FK → articles.id */
    articleId: text("article_id").notNull(),
    expertId: uuid("expert_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    /** null for full-article; FK → article_paragraphs.id */
    paragraphId: text("paragraph_id"),
    /** reading_start | reading_pause | scoring_start | scoring_pause | tab_hidden | tab_visible */
    eventType: text("event_type").notNull(),
    /** Client-supplied timestamp (UTC epoch ms stored as timestamp) */
    timestamp: timestamp("timestamp").notNull(),
    createdAt: timestamp("created_at").notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    check(
      "time_events_type_check",
      sql`${t.eventType} IN ('reading_start', 'reading_pause', 'scoring_start', 'scoring_pause', 'tab_hidden', 'tab_visible')`
    ),
  ]
);
