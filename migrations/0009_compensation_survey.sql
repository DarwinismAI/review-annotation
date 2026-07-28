CREATE TABLE IF NOT EXISTS "compensation_survey_responses" (
  "id" text PRIMARY KEY,
  "expert_id" uuid NOT NULL UNIQUE
    REFERENCES "profiles"("id") ON DELETE CASCADE,
  "expected_rate" text,
  "unit" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "compensation_survey_unit_check"
    CHECK ("unit" IN ('per_article', 'per_hour'))
);
