import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2";
import { profiles } from "./schema.sqlite";

export const timeEvents = sqliteTable("time_events", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  assignmentId: text("assignment_id").notNull(),
  articleId: text("article_id").notNull(),
  expertId: text("expert_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  paragraphId: text("paragraph_id"),
  eventType: text("event_type", {
    enum: ["reading_start", "reading_pause", "scoring_start", "scoring_pause", "tab_hidden", "tab_visible"],
  }).notNull(),
  timestamp: text("timestamp").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});
