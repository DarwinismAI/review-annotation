import { pgTable, text, timestamp, uuid, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { profiles } from "./schema";

/**
 * One-time compensation expectation survey per expert.
 * UNIQUE(expert_id) ensures a single response - no edits/replays.
 */
export const compensationSurveyResponses = pgTable(
  "compensation_survey_responses",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    expertId: uuid("expert_id")
      .notNull()
      .unique()
      .references(() => profiles.id, { onDelete: "cascade" }),
    expectedRate: text("expected_rate"),
    unit: text("unit"),
    createdAt: timestamp("created_at").notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    check(
      "compensation_survey_unit_check",
      sql`${t.unit} IN ('per_article', 'per_hour')`
    ),
  ]
);
