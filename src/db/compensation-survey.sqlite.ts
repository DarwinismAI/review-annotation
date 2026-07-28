import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2";
import { profiles } from "./schema.sqlite";

export const compensationSurveyResponses = sqliteTable(
  "compensation_survey_responses",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    expertId: text("expert_id")
      .notNull()
      .unique()
      .references(() => profiles.id, { onDelete: "cascade" }),
    expectedRate: text("expected_rate"),
    unit: text("unit", { enum: ["per_article", "per_hour"] }),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  }
);
