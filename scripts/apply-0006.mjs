import postgres from "postgres";
import { readFileSync } from "node:fs";

try {
  const env = readFileSync(".env.local", "utf8");
  for (const line of env.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
} catch {}

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
const sql = postgres(url, { max: 1, prepare: false });

try {
  // 1) Check if constraint already exists (idempotent)
  const exists = await sql`
    SELECT 1 FROM pg_constraint WHERE conname = 'assignments_article_expert_unique'
  `;
  if (exists.length === 0) {
    console.log("Applying migration 0006...");
    await sql`
      ALTER TABLE assignments
        ADD CONSTRAINT assignments_article_expert_unique UNIQUE (article_id, expert_id)
    `;
    console.log("✓ Constraint added");
  } else {
    console.log("✓ Constraint already exists, skipping");
  }

  // 2) Backfill: list current broadcast articles + matching experts
  const stats = await sql`
    SELECT
      (SELECT COUNT(*) FROM assignments) AS total_assignments,
      (SELECT COUNT(*) FROM articles a JOIN batches b ON a.batch_id=b.id
       WHERE b.assignment_mode='broadcast' AND a.enabled=true
         AND (b.broadcast_expires_at IS NULL OR b.broadcast_expires_at > now())) AS active_broadcast_articles,
      (SELECT COUNT(DISTINCT user_id) FROM expert_domains) AS experts_with_domains
  `;
  console.log("Pre-backfill state:", stats[0]);

  // 3) Backfill: for every broadcast article × matching-domain expert, insert if not exists
  console.log("Running backfill...");
  const result = await sql`
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
      WHERE b.assignment_mode = 'broadcast'
        AND a.enabled = true
        AND (b.broadcast_expires_at IS NULL OR b.broadcast_expires_at > now())
      ON CONFLICT ON CONSTRAINT assignments_article_expert_unique DO NOTHING
      RETURNING article_id
    )
    UPDATE articles SET status = 'assigned'
    WHERE id IN (SELECT article_id FROM inserted) AND status = 'unassigned'
    RETURNING id
  `;
  console.log(`✓ Backfill: flipped ${result.length} articles to status='assigned'`);

  const after = await sql`SELECT COUNT(*) AS n FROM assignments`;
  console.log(`Post-backfill total assignments: ${after[0].n}`);

  // 4) Verify dohxuanhai now has assignments
  const dox = await sql`
    SELECT COUNT(*) AS n
    FROM assignments a
    JOIN profiles p ON a.expert_id = p.id
    WHERE p.email = 'dohxuanhai@gmail.com'
  `;
  console.log(`dohxuanhai@gmail.com assignments: ${dox[0].n}`);
} catch (err) {
  console.error("Error:", err.message);
  process.exit(1);
} finally {
  await sql.end();
}
