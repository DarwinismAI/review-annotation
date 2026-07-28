// @ts-nocheck
/**
 * Auto-assign helpers for broadcast batches (multi-reviewer model).
 *
 * Mental model: in broadcast mode, every active article gets an assignment row
 * for every expert whose `expert_domains` overlaps the batch's `domain`. Experts
 * never self-claim - articles appear in their "Bài của tôi" automatically.
 *
 * Sub-domain narrowing (since migration 0010/0011): if an expert has any
 * `expert_sub_domains` rows for the article's parent domain, only articles whose
 * `sub_domain_id` is in that set match. NULL `sub_domain_id` on the article
 * passes through (legacy / unclassified rows fall back to parent-domain match).
 *
 * Idempotency: relies on UNIQUE (article_id, expert_id) on assignments
 * (migration 0006). All inserts use ON CONFLICT DO NOTHING; concurrent calls
 * collapse safely.
 *
 * Article.status flip: when an assignment is the FIRST for an article, the
 * article's status moves from 'unassigned' → 'assigned' (preserves admin
 * metrics). Subsequent assignments don't touch status. Done in a single
 * UPDATE … WHERE status='unassigned' (idempotent + race-safe).
 */
import { sql } from "drizzle-orm";
import { db as defaultDb } from "@/db/client";

/**
 * SQL fragment: "expert (= ed.user_id) accepts this article's sub_domain_id".
 *
 * True if: expert has no sub-domain row for the batch's parent domain (no narrowing),
 * OR the article has no sub_domain_id (unclassified - accept),
 * OR the article's sub_domain_id is in the expert's set.
 *
 * `b.domain` is a literal domain key. We map it to the
 * sub_domain_id prefix via CASE - keeps the lookup table inline so no extra join.
 */
const SUB_DOMAIN_MATCHES = sql`
  (
    NOT EXISTS (
      SELECT 1 FROM expert_sub_domains esd
      WHERE esd.user_id = ed.user_id
        AND esd.sub_domain_id LIKE CASE b.domain
          WHEN 'law'     THEN 'law\\_%'
          WHEN 'medical' THEN 'med\\_%'
          WHEN 'tourism' THEN 'trv\\_%'
          WHEN 'safety_compliance' THEN 'saf\\_%'
        END ESCAPE '\\'
    )
    OR a.sub_domain_id IS NULL
    OR EXISTS (
      SELECT 1 FROM expert_sub_domains esd
      WHERE esd.user_id = ed.user_id AND esd.sub_domain_id = a.sub_domain_id
    )
  )
`;

/**
 * Medical-only micro-domain narrowing below `a.sub_domain_id`.
 *
 * True if: the batch is not medical, OR the article has no micro-domain, OR the
 * expert has no micro rows under that article's parent sub-domain, OR the
 * article micro-domain is in the expert's exact set.
 */
const MEDICAL_MICRO_DOMAIN_MATCHES = sql`
  (
    b.domain <> 'medical'
    OR a.medical_micro_domain_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM expert_medical_micro_domains emd
      WHERE emd.user_id = ed.user_id
        AND substring(emd.micro_domain_id from 1 for 6) = a.sub_domain_id
    )
    OR EXISTS (
      SELECT 1 FROM expert_medical_micro_domains emd
      WHERE emd.user_id = ed.user_id
        AND emd.micro_domain_id = a.medical_micro_domain_id
    )
  )
`;

/**
 * For one expert: insert assignments for every active broadcast article in
 * batches whose domain matches any of the expert's domains.
 *
 * Call after expert_domains are inserted/updated (admin setup, profile edit).
 */
export async function assignBroadcastForExpert(expertId: string, db = defaultDb): Promise<number> {
  // SQLite: broadcast auto-assign not available (Postgres-specific SQL)
  if (process.env.LOCAL_DB_PATH) return 0;

  const result = await db.execute(sql`
    WITH inserted AS (
      INSERT INTO assignments (id, article_id, expert_id, pay_rate, status, assigned_at, created_at, updated_at)
      SELECT
        substr(md5(random()::text || clock_timestamp()::text || a.id), 1, 24),
        a.id,
        ${expertId}::uuid,
        COALESCE(b.pay_rate_per_article, 0),
        'assigned',
        (extract(epoch from now()) * 1000)::bigint,
        (extract(epoch from now()) * 1000)::bigint,
        (extract(epoch from now()) * 1000)::bigint
      FROM articles a
      JOIN batches b ON a.batch_id = b.id
      JOIN expert_domains ed ON ed.domain = b.domain AND ed.user_id = ${expertId}::uuid
      WHERE b.assignment_mode = 'broadcast'
        AND a.enabled = true
        AND (b.broadcast_expires_at IS NULL OR b.broadcast_expires_at > now())
        AND ${SUB_DOMAIN_MATCHES}
        AND ${MEDICAL_MICRO_DOMAIN_MATCHES}
      ON CONFLICT ON CONSTRAINT assignments_article_expert_unique DO NOTHING
      RETURNING article_id
    )
    UPDATE articles SET status = 'assigned'
    WHERE id IN (SELECT article_id FROM inserted) AND status = 'unassigned'
  `);
  return result?.rowCount ?? 0;
}

/**
 * For one article (any time it's enabled in a broadcast batch): insert
 * assignments for every matching-domain expert.
 *
 * Call from article-toggle (when enabled=true) and from batch-create
 * (after the article rows are inserted).
 */
export async function assignBroadcastForArticle(articleId: string, db = defaultDb): Promise<number> {
  if (process.env.LOCAL_DB_PATH) return 0;

  const result = await db.execute(sql`
    WITH inserted AS (
      INSERT INTO assignments (id, article_id, expert_id, pay_rate, status, assigned_at, created_at, updated_at)
      SELECT
        substr(md5(random()::text || clock_timestamp()::text || ed.user_id::text), 1, 24),
        a.id,
        ed.user_id,
        COALESCE(b.pay_rate_per_article, 0),
        'assigned',
        (extract(epoch from now()) * 1000)::bigint,
        (extract(epoch from now()) * 1000)::bigint,
        (extract(epoch from now()) * 1000)::bigint
      FROM articles a
      JOIN batches b ON a.batch_id = b.id
      JOIN expert_domains ed ON ed.domain = b.domain
      WHERE a.id = ${articleId}
        AND b.assignment_mode = 'broadcast'
        AND a.enabled = true
        AND (b.broadcast_expires_at IS NULL OR b.broadcast_expires_at > now())
        AND ${SUB_DOMAIN_MATCHES}
        AND ${MEDICAL_MICRO_DOMAIN_MATCHES}
      ON CONFLICT ON CONSTRAINT assignments_article_expert_unique DO NOTHING
      RETURNING article_id
    )
    UPDATE articles SET status = 'assigned'
    WHERE id IN (SELECT article_id FROM inserted) AND status = 'unassigned'
  `);
  return result?.rowCount ?? 0;
}

/**
 * For a freshly created broadcast batch: assign all its articles to all
 * matching-domain experts in one shot.
 */
export async function assignBroadcastForBatch(batchId: string, db = defaultDb): Promise<number> {
  if (process.env.LOCAL_DB_PATH) return 0;

  const result = await db.execute(sql`
    WITH inserted AS (
      INSERT INTO assignments (id, article_id, expert_id, pay_rate, status, assigned_at, created_at, updated_at)
      SELECT
        substr(md5(random()::text || clock_timestamp()::text || a.id || ed.user_id::text), 1, 24),
        a.id,
        ed.user_id,
        COALESCE(b.pay_rate_per_article, 0),
        'assigned',
        (extract(epoch from now()) * 1000)::bigint,
        (extract(epoch from now()) * 1000)::bigint,
        (extract(epoch from now()) * 1000)::bigint
      FROM articles a
      JOIN batches b ON a.batch_id = b.id
      JOIN expert_domains ed ON ed.domain = b.domain
      WHERE b.id = ${batchId}
        AND b.assignment_mode = 'broadcast'
        AND a.enabled = true
        AND (b.broadcast_expires_at IS NULL OR b.broadcast_expires_at > now())
        AND ${SUB_DOMAIN_MATCHES}
        AND ${MEDICAL_MICRO_DOMAIN_MATCHES}
      ON CONFLICT ON CONSTRAINT assignments_article_expert_unique DO NOTHING
      RETURNING article_id
    )
    UPDATE articles SET status = 'assigned'
    WHERE id IN (SELECT DISTINCT article_id FROM inserted) AND status = 'unassigned'
  `);
  return result?.rowCount ?? 0;
}
