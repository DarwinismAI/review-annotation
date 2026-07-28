-- Round-9 prototype evolved claim rating from 5-star to 3-way verdict; this schema reflects final shape.
--
-- Migration 0007: inline comments + claim uncertainty (3-way verdict).
--
-- Adds two tables:
--   article_comments — expert inline annotations anchored to a text quote within a section.
--   claim_ratings    — 3-way verdict (correct / incorrect / unsure) per claim per assignment.
--                      Toggle off = delete row (no verdict). unsure_ratio = COUNT FILTER WHERE verdict='unsure' / COUNT(*).

BEGIN;

-- 1. article_comments
CREATE TABLE article_comments (
  id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  article_id         TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  assignment_id      TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  expert_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  section_id         TEXT NOT NULL,                -- 'sec-0' | 'sec-1' | 'sec-2' (string index)
  anchor_quote       TEXT NOT NULL,                -- selected text content (hybrid resolver primary key)
  anchor_prefix      TEXT,                         -- ~30 chars before anchor_quote
  anchor_suffix      TEXT,                         -- ~30 chars after anchor_quote
  anchor_offset_start INTEGER,                     -- best-effort byte offset within section (nullable fallback)
  anchor_offset_end   INTEGER,
  body               TEXT NOT NULL CHECK (length(body) > 0 AND length(body) <= 2000),
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_article_comments_article  ON article_comments (article_id, section_id);
CREATE INDEX idx_article_comments_expert   ON article_comments (expert_id);

-- 2. claim_ratings (3-way verdict — no stars, no free-text note)
CREATE TABLE claim_ratings (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  assignment_id TEXT    NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  expert_id     UUID    NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  section_id    TEXT    NOT NULL,
  claim_idx     INTEGER NOT NULL,                  -- 0-based index of claim within section
  verdict       TEXT    NOT NULL CHECK (verdict IN ('correct', 'incorrect', 'unsure')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, section_id, claim_idx)    -- one verdict per claim per assignment
);

CREATE INDEX idx_claim_ratings_assignment ON claim_ratings (assignment_id);

COMMIT;
