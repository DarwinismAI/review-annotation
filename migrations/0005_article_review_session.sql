-- Migration 0005: per-article review session time tracking (append-only).
-- Runs AFTER 0004 (supabase auth swap). Does not touch existing time_events table.

BEGIN;

-- 1. Table
CREATE TABLE article_review_session (
  id            TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  start_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_at        TIMESTAMPTZ,
  closed_reason TEXT CHECK (closed_reason IS NULL OR closed_reason IN ('navigate','blur','submit','reopen','watchdog')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Indexes
CREATE INDEX idx_session_assignment ON article_review_session (assignment_id);

-- Partial index — used by open-session lookup and idempotent close updates
CREATE INDEX idx_session_open ON article_review_session (assignment_id)
  WHERE end_at IS NULL;

-- 3. pg_cron maintenance jobs (run manually after deploy — requires pg_cron extension)
--
-- Watchdog: every 15 minutes, close orphan sessions older than 90 min
-- SELECT cron.schedule('article-review-session-watchdog', '*/15 * * * *', $$
--   UPDATE article_review_session
--   SET end_at = LEAST(now(), start_at + interval '90 minutes'),
--       closed_reason = 'watchdog'
--   WHERE end_at IS NULL AND start_at < now() - interval '90 minutes';
-- $$);
--
-- Quarterly purge (run manually or via cron):
-- DELETE FROM article_review_session WHERE created_at < now() - interval '13 months';

COMMIT;
