ALTER TABLE "review_scores"
ADD CONSTRAINT "review_scores_criterion_id_rubric_criteria_id_fk"
FOREIGN KEY ("criterion_id")
REFERENCES "public"."rubric_criteria"("id")
ON DELETE RESTRICT
ON UPDATE NO ACTION;
