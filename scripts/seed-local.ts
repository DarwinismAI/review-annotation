/**
 * One-shot: create SQLite tables from schema definitions + seed admin user.
 * Run: LOCAL_DB_PATH=file:./local.db npx tsx scripts/seed-local.ts
 */
import { createClient } from "@libsql/client";

const DB_PATH = process.env.LOCAL_DB_PATH ?? "file:./local.db";

const SQL = `
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'annotator' CHECK(role IN ('superadmin', 'admin', 'annotator')),
  name TEXT,
  image TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expert_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK(domain IN ('law', 'medical', 'tourism', 'safety_compliance')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'inactive')),
  invite_token TEXT UNIQUE,
  invite_expires_at INTEGER,
  invited_at INTEGER NOT NULL,
  activated_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS expert_domains (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK(domain IN ('law', 'medical', 'tourism', 'safety_compliance')),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS expert_sub_domains (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sub_domain_id TEXT NOT NULL CHECK(sub_domain_id IN (
    'law_01','law_02','law_03','law_04','law_05','law_06','law_07',
    'med_01','med_02','med_03','med_04','med_05','med_06','med_07',
    'trv_01','trv_02','trv_03','trv_04','trv_05','trv_06','trv_07','trv_08',
    'saf_01'
  )),
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, sub_domain_id)
);
CREATE INDEX IF NOT EXISTS expert_sub_domains_user_idx ON expert_sub_domains(user_id);

CREATE TABLE IF NOT EXISTS expert_medical_micro_domains (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  micro_domain_id TEXT NOT NULL CHECK(micro_domain_id GLOB 'med_*_*'),
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, micro_domain_id)
);
CREATE INDEX IF NOT EXISTS expert_medical_micro_domains_user_idx ON expert_medical_micro_domains(user_id);
CREATE INDEX IF NOT EXISTS expert_medical_micro_domains_micro_idx ON expert_medical_micro_domains(micro_domain_id);

CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL CHECK(domain IN ('law', 'medical', 'tourism', 'safety_compliance')),
  article_type TEXT NOT NULL CHECK(article_type IN ('full', 'paragraph')),
  zip_r2_key TEXT NOT NULL,
  total_articles INTEGER NOT NULL DEFAULT 0,
  error_files TEXT,
  pay_rate_per_article INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready', 'in_progress', 'completed')),
  assignment_mode TEXT NOT NULL DEFAULT 'manual' CHECK(assignment_mode IN ('manual', 'broadcast')),
  broadcast_expires_at TEXT,
  created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('full', 'paragraph')),
  pdf_r2_key TEXT,
  text_content TEXT,
  source_format TEXT NOT NULL DEFAULT 'pdf' CHECK(source_format IN ('pdf', 'json')),
  source_storage_key TEXT,
  payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'unassigned' CHECK(status IN ('unassigned', 'assigned', 'in_review', 'completed')),
  enabled INTEGER NOT NULL DEFAULT 1,
  disabled_at TEXT,
  sub_domain_id TEXT CHECK(sub_domain_id IS NULL OR sub_domain_id IN (
    'law_01','law_02','law_03','law_04','law_05','law_06','law_07',
    'med_01','med_02','med_03','med_04','med_05','med_06','med_07',
    'trv_01','trv_02','trv_03','trv_04','trv_05','trv_06','trv_07','trv_08',
    'saf_01'
  )),
  medical_micro_domain_id TEXT CHECK(medical_micro_domain_id IS NULL OR medical_micro_domain_id GLOB 'med_*_*'),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS articles_sub_domain_idx ON articles(sub_domain_id);
CREATE INDEX IF NOT EXISTS articles_medical_micro_domain_idx ON articles(medical_micro_domain_id);

CREATE TABLE IF NOT EXISTS article_paragraphs (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  paragraph_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS article_review_session (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT,
  closed_reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_assignment ON article_review_session(assignment_id);

CREATE TABLE IF NOT EXISTS article_segments (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  "order" INTEGER NOT NULL,
  text TEXT NOT NULL,
  color TEXT NOT NULL CHECK(color IN ('green', 'yellow', 'red', 'neutral')),
  type TEXT NOT NULL CHECK(type IN ('highlight', 'badge', 'warning', 'score', 'text')),
  score_value REAL,
  page_index INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  expert_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  pay_rate INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'assigned' CHECK(status IN ('assigned', 'in_review', 'completed')),
  assigned_at INTEGER NOT NULL,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS assignments_article_expert_unique ON assignments(article_id, expert_id);

CREATE TABLE IF NOT EXISTS rubrics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL CHECK(domain IN ('law', 'medical', 'tourism', 'safety_compliance')),
  created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rubric_criteria (
  id TEXT PRIMARY KEY,
  rubric_id TEXT NOT NULL REFERENCES rubrics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  scale TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS article_comments (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  assignment_id TEXT NOT NULL,
  expert_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL,
  anchor_quote TEXT NOT NULL,
  anchor_prefix TEXT,
  anchor_suffix TEXT,
  anchor_offset_start INTEGER,
  anchor_offset_end INTEGER,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_article_comments_article ON article_comments(article_id, section_id);
CREATE INDEX IF NOT EXISTS idx_article_comments_expert ON article_comments(expert_id);

CREATE TABLE IF NOT EXISTS claim_ratings (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  expert_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL,
  claim_idx INTEGER NOT NULL,
  verdict TEXT NOT NULL CHECK(verdict IN ('correct', 'incorrect', 'unsure')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS claim_ratings_assignment_section_claim_unique ON claim_ratings(assignment_id, section_id, claim_idx);
CREATE INDEX IF NOT EXISTS idx_claim_ratings_assignment ON claim_ratings(assignment_id);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  expert_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  paragraph_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'completed', 'locked')),
  submitted_at TEXT,
  locked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_scores (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  criterion_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS time_events (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  expert_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  paragraph_id TEXT,
  event_type TEXT NOT NULL CHECK(event_type IN ('reading_start', 'reading_pause', 'scoring_start', 'scoring_pause', 'tab_hidden', 'tab_visible')),
  timestamp TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  schema_fingerprint TEXT NOT NULL,
  display_config TEXT NOT NULL,
  required_append_fields TEXT NOT NULL,
  created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dataset_imports (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  source_filename TEXT NOT NULL,
  status TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  missing_fields_report TEXT,
  created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dataset_rows (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  import_id TEXT NOT NULL REFERENCES dataset_imports(id) ON DELETE CASCADE,
  internal_row_id INTEGER NOT NULL,
  raw_json TEXT NOT NULL,
  source_id TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS dataset_rows_dataset_internal_row_unique ON dataset_rows(dataset_id, internal_row_id);
CREATE INDEX IF NOT EXISTS dataset_rows_dataset_idx ON dataset_rows(dataset_id);

CREATE TABLE IF NOT EXISTS annotation_metrics (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  scale_json TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS annotation_metrics_dataset_key_unique ON annotation_metrics(dataset_id, key);

CREATE TABLE IF NOT EXISTS annotation_assignment_runs (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  target_overlap INTEGER NOT NULL,
  metric_ids TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS annotation_assignments (
  id TEXT PRIMARY KEY,
  assignment_run_id TEXT NOT NULL REFERENCES annotation_assignment_runs(id) ON DELETE CASCADE,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  row_id TEXT NOT NULL REFERENCES dataset_rows(id) ON DELETE CASCADE,
  annotator_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  metric_ids TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  target_overlap INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'assigned',
  assigned_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS annotation_assignments_row_annotator_metric_unique ON annotation_assignments(row_id, annotator_id, metric_key);
CREATE INDEX IF NOT EXISTS annotation_assignments_dataset_idx ON annotation_assignments(dataset_id);
CREATE INDEX IF NOT EXISTS annotation_assignments_annotator_idx ON annotation_assignments(annotator_id);

CREATE TABLE IF NOT EXISTS annotation_results (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES annotation_assignments(id) ON DELETE CASCADE,
  row_id TEXT NOT NULL REFERENCES dataset_rows(id) ON DELETE CASCADE,
  annotator_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  metric_id TEXT NOT NULL REFERENCES annotation_metrics(id) ON DELETE CASCADE,
  value TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  submitted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS annotation_results_assignment_metric_unique ON annotation_results(assignment_id, metric_id);
CREATE INDEX IF NOT EXISTS annotation_results_row_metric_idx ON annotation_results(row_id, metric_id);
CREATE INDEX IF NOT EXISTS annotation_results_assignment_status_idx ON annotation_results(assignment_id, status);
CREATE INDEX IF NOT EXISTS annotation_results_row_metric_status_idx ON annotation_results(row_id, metric_id, status);
`;

async function main() {
  console.log(`Creating SQLite DB: ${DB_PATH}`);
  const client = createClient({ url: DB_PATH });

  // Enable WAL + foreign keys
  await client.executeMultiple(`PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;`);

  // Run all CREATE TABLE statements
  const statements = SQL.split(";").map((s) => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    try {
      await client.execute(stmt + ";");
    } catch (err: any) {
      if (!err.message?.includes("already exists")) {
        console.error(`  FAIL: ${stmt.slice(0, 60)}...`, err.message);
      }
    }
  }

  // Idempotent column adds for existing local.db files that pre-date sub-domain support.
  // SQLite has no "ADD COLUMN IF NOT EXISTS" — swallow the duplicate-column error.
  // Index is re-created after ALTER because the index in the main SQL block fails
  // silently when the column doesn't yet exist on first patch run.
  const POST_ALTER = [
    `ALTER TABLE articles ADD COLUMN sub_domain_id TEXT`,
    `CREATE INDEX IF NOT EXISTS articles_sub_domain_idx ON articles(sub_domain_id)`,
    `ALTER TABLE articles ADD COLUMN medical_micro_domain_id TEXT`,
    `CREATE INDEX IF NOT EXISTS articles_medical_micro_domain_idx ON articles(medical_micro_domain_id)`,
    `ALTER TABLE annotation_results ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'`,
    `CREATE INDEX IF NOT EXISTS annotation_results_assignment_status_idx ON annotation_results(assignment_id, status)`,
    `CREATE INDEX IF NOT EXISTS annotation_results_row_metric_status_idx ON annotation_results(row_id, metric_id, status)`,
  ];
  for (const stmt of POST_ALTER) {
    try {
      await client.execute(stmt + ";");
    } catch (err: any) {
      if (!/duplicate column|already exists/i.test(err.message ?? "")) {
        console.error(`  FAIL: ${stmt}`, err.message);
      }
    }
  }

  // Seed local admin users
  const now = new Date().toISOString();
  const adminId = "00000000-0000-0000-0000-000000000001";
  await client.execute({
    sql: `INSERT OR IGNORE INTO profiles (id, email, role, name, created_at, updated_at)
          VALUES (?, ?, 'admin', 'Admin', ?, ?)`,
    args: [adminId, "admin@review-annotation.local", now, now],
  });
  await client.execute({
    sql: `INSERT OR IGNORE INTO profiles (id, email, role, name, created_at, updated_at)
          VALUES (?, ?, 'superadmin', 'Superadmin', ?, ?)`,
    args: ["00000000-0000-0000-0000-000000000099", "superadmin@review-annotation.local", now, now],
  });

  console.log("✓ Database ready. Admin: admin@review-annotation.local · Superadmin: superadmin@review-annotation.local");
  client.close();
}

main().catch(console.error);
