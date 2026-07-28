-- Migration 0006: switch broadcast model from self-claim to auto-assign multi-reviewer.
--
-- Previously: 1 broadcast article → 1 expert (first to claim wins, enforced by status flip).
-- Now: 1 broadcast article → N matching-domain experts (all auto-assigned). Per-expert
-- review state lives in assignments.status; article.status remains for admin metrics
-- (flipped to 'assigned' on first assignment, never reverted).
--
-- Adds UNIQUE (article_id, expert_id) so auto-assign can use ON CONFLICT DO NOTHING
-- and concurrent inserts collapse to one row per (article, expert) pair.

BEGIN;

ALTER TABLE assignments
  ADD CONSTRAINT assignments_article_expert_unique UNIQUE (article_id, expert_id);

COMMIT;
