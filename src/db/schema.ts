import { pgTable, pgSchema, text, integer, boolean, timestamp, bigint, real, check, uuid, index, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

// ─── E1: Auth / User Management (Supabase Auth) ─────────────────────────────
//
// User identity is owned by Supabase Auth (`auth.users`). The `profiles`
// table mirrors auth.users 1:1 via UUID PK + ON DELETE CASCADE, populated by
// a Postgres trigger `on_auth_user_created` (see migration 0004). All public
// tables FK to `profiles.id` instead of `auth.users.id` directly so app code
// never has to reach into the `auth` schema.

const authSchema = pgSchema("auth");

/** Read-only reference to Supabase's auth.users — drizzle FK target for `profiles`. */
export const authUsers = authSchema.table("users", {
  id: uuid("id").primaryKey(),
  email: text("email"),
});

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().references(() => authUsers.id, { onDelete: "cascade" }),
    email: text("email").notNull().unique(),
    /** "admin" | "expert" */
    role: text("role").notNull().default("expert"),
    name: text("name"),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("profiles_role_check", sql`${t.role} IN ('admin', 'expert')`)]
);

export const expertProfiles = pgTable(
  "expert_profiles",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    userId: uuid("user_id").notNull().unique().references(() => profiles.id, { onDelete: "cascade" }),
    /** Primary domain (back-compat). Multi-domain stored in expert_domains. */
    domain: text("domain").notNull(),
    /** "pending" | "active" | "inactive" */
    status: text("status").notNull().default("pending"),
    inviteToken: text("invite_token").unique(),
    inviteExpiresAt: bigint("invite_expires_at", { mode: "number" }),
    invitedAt: bigint("invited_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
    activatedAt: bigint("activated_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
  },
  (t) => [
    check("domain_check", sql`${t.domain} IN ('law', 'medical', 'tourism', 'safety_compliance')`),
    check("status_check", sql`${t.status} IN ('pending', 'active', 'inactive')`),
  ]
);

/**
 * Multi-domain join — expert can opt into product domains.
 * Source-of-truth for /expert/articles broadcast filtering.
 * `expert_profiles.domain` retained as primary/back-compat field; new code reads here.
 */
export const expertDomains = pgTable(
  "expert_domains",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    /** Product domain key. */
    domain: text("domain").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
  },
  (t) => [
    check("expert_domains_domain_check", sql`${t.domain} IN ('law', 'medical', 'tourism', 'safety_compliance')`),
  ]
);

/**
 * Optional sub-domain preferences per expert. 22 allowed IDs total, prefixed by parent domain
 * (`law_*` / `med_*` / `trv_*` / `saf_*`). Taxonomy: seed_data/[Vivipedia] Dataset_Definition_Final.csv.
 *
 * Semantics: an empty set for a given parent domain means "any sub-domain of that domain"
 * (no narrowing). Only persisted for domains the expert is opted into — API validates the prefix.
 */
export const expertSubDomains = pgTable(
  "expert_sub_domains",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    /** law_01..law_07, med_01..med_07, trv_01..trv_08, saf_01 */
    subDomainId: text("sub_domain_id").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
  },
  (t) => [
    check(
      "expert_sub_domains_id_check",
      sql`${t.subDomainId} IN (
        'law_01','law_02','law_03','law_04','law_05','law_06','law_07',
        'med_01','med_02','med_03','med_04','med_05','med_06','med_07',
        'trv_01','trv_02','trv_03','trv_04','trv_05','trv_06','trv_07','trv_08',
        'saf_01'
      )`
    ),
    unique("expert_sub_domains_user_sub_unique").on(t.userId, t.subDomainId),
    index("expert_sub_domains_user_idx").on(t.userId),
    index("expert_sub_domains_sub_idx").on(t.subDomainId),
  ]
);

/**
 * Optional medical-only micro-domain preferences under each `med_*` sub-domain.
 *
 * Semantics mirror `expert_sub_domains`: no rows under a selected medical
 * sub-domain means "any micro-domain inside that sub-domain"; rows narrow
 * routing to exact `med_XX_YY` article classifications.
 */
export const expertMedicalMicroDomains = pgTable(
  "expert_medical_micro_domains",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    /** med_01_01..med_07_05 — app validation owns the concrete taxonomy. */
    microDomainId: text("micro_domain_id").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
  },
  (t) => [
    check("expert_medical_micro_domains_id_check", sql`${t.microDomainId} LIKE 'med\\_%\\_%' ESCAPE '\\'`),
    unique("expert_medical_micro_domains_user_micro_unique").on(t.userId, t.microDomainId),
    index("expert_medical_micro_domains_user_idx").on(t.userId),
    index("expert_medical_micro_domains_micro_idx").on(t.microDomainId),
  ]
);

// ─── E2: Article Management + Assignment ────────────────────────────────────

export const batches = pgTable(
  "batches",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    name: text("name").notNull(),
    /** Product domain key. */
    domain: text("domain").notNull(),
    /** "full" | "paragraph" */
    articleType: text("article_type").notNull(),
    /** local path or r2 key */
    zipStorageKey: text("zip_r2_key").notNull(),
    totalArticles: integer("total_articles").notNull().default(0),
    /** JSON array of filenames that failed extraction */
    errorFiles: text("error_files"),
    payRatePerArticle: integer("pay_rate_per_article").notNull().default(0),
    /** "ready" | "in_progress" | "completed" */
    status: text("status").notNull().default("ready"),
    /**
     * "manual" — admin assigns each article (legacy v1 default).
     * "broadcast" — experts in matching domain self-claim from open pool.
     * UI labels: "Thủ công" / "Tự động" via lib/labels.ts (NEVER show "broadcast" in UI).
     */
    assignmentMode: text("assignment_mode").notNull().default("manual"),
    /** Required when assignmentMode = "broadcast" — pool closes for new claimants after this. */
    broadcastExpiresAt: timestamp("broadcast_expires_at"),
    createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
  },
  (t) => [
    check("batches_domain_check", sql`${t.domain} IN ('law', 'medical', 'tourism', 'safety_compliance')`),
    check("batches_type_check", sql`${t.articleType} IN ('full', 'paragraph')`),
    check("batches_status_check", sql`${t.status} IN ('ready', 'in_progress', 'completed')`),
    check("batches_assignment_mode_check", sql`${t.assignmentMode} IN ('manual', 'broadcast')`),
  ]
);

export const articles = pgTable(
  "articles",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    batchId: text("batch_id").notNull().references(() => batches.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** "full" | "paragraph" */
    type: text("type").notNull(),
    /**
     * Source storage key.
     * Nullable because JSON-sourced articles persist their payload in
     * `payloadJson` and the original `.json` file is kept under the batch's
     * `_uploads/` folder via `sourceStorageKey`. Older PDF-sourced articles
     * still carry their PDF key here.
     */
    pdfStorageKey: text("pdf_r2_key"),
    textContent: text("text_content"),
    /**
     * Where the article came from. "pdf" = legacy PDF zip flow. "json" =
     * structured payload uploaded as .json (single) or .zip-of-.json (batch).
     */
    sourceFormat: text("source_format").notNull().default("pdf"),
    /**
     * Storage key for the raw source file (.json or .pdf) under the batch's
     * folder. Optional — pdfStorageKey holds the same info for older rows.
     */
    sourceStorageKey: text("source_storage_key"),
    /**
     * Full structured payload for sourceFormat='json' — verbatim JSON text
     * containing title, sections[], claims[], scores etc. Empty for PDF rows.
     */
    payloadJson: text("payload_json"),
    /** "unassigned" | "assigned" | "in_review" | "completed" */
    status: text("status").notNull().default("unassigned"),
    /**
     * Admin can disable an article mid-batch (e.g. wrong content).
     * false → hidden from new experts + blocks new reviews. Active drafts get a 24h grace
     * window (see disabled_at) before becoming read-only.
     */
    enabled: boolean("enabled").notNull().default(true),
    /** Set when admin toggles enabled=false. Grace window = disabled_at + 24h. */
    disabledAt: timestamp("disabled_at"),
    /**
     * Optional sub-domain classification from the JSON payload (e.g. "med_01", "law_03").
     * Drives broadcast filtering when experts opted into specific sub-domains; NULL → no narrowing.
     */
    subDomainId: text("sub_domain_id"),
    /**
     * Optional medical-only micro-domain classification below `sub_domain_id`
     * (e.g. "med_01_01" under "med_01"). NULL for non-medical/legacy rows.
     */
    medicalMicroDomainId: text("medical_micro_domain_id"),
    createdAt: bigint("created_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
  },
  (t) => [
    check("articles_type_check", sql`${t.type} IN ('full', 'paragraph')`),
    check("articles_status_check", sql`${t.status} IN ('unassigned', 'assigned', 'in_review', 'completed')`),
    check("articles_source_format_check", sql`${t.sourceFormat} IN ('pdf', 'json')`),
    check(
      "articles_sub_domain_id_check",
      sql`${t.subDomainId} IS NULL OR ${t.subDomainId} IN (
        'law_01','law_02','law_03','law_04','law_05','law_06','law_07',
        'med_01','med_02','med_03','med_04','med_05','med_06','med_07',
        'trv_01','trv_02','trv_03','trv_04','trv_05','trv_06','trv_07','trv_08',
        'saf_01'
      )`
    ),
    index("articles_sub_domain_idx").on(t.subDomainId),
    check(
      "articles_medical_micro_domain_id_check",
      sql`${t.medicalMicroDomainId} IS NULL OR ${t.medicalMicroDomainId} LIKE 'med\\_%\\_%' ESCAPE '\\'`
    ),
    index("articles_medical_micro_domain_idx").on(t.medicalMicroDomainId),
  ]
);

export const articleParagraphs = pgTable("article_paragraphs", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  articleId: text("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  paragraphIndex: integer("paragraph_index").notNull(),
  text: text("text").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
});

export const assignments = pgTable(
  "assignments",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    articleId: text("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
    expertId: uuid("expert_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    payRate: integer("pay_rate").notNull().default(0),
    /** "assigned" | "in_review" | "completed" */
    status: text("status").notNull().default("assigned"),
    assignedAt: bigint("assigned_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
    completedAt: bigint("completed_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
  },
  (t) => [
    check("assignments_status_check", sql`${t.status} IN ('assigned', 'in_review', 'completed')`),
    unique("assignments_article_expert_unique").on(t.articleId, t.expertId),
  ]
);

export const rubrics = pgTable("rubrics", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  name: text("name").notNull(),
  /** Product domain key. */
  domain: text("domain").notNull(),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
});

export const rubricCriteria = pgTable("rubric_criteria", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  rubricId: text("rubric_id").notNull().references(() => rubrics.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  /** JSON array of {score, label, description} */
  scale: text("scale").notNull(),
  required: integer("required").notNull().default(1),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
});

/**
 * Colored text segments extracted from PDF by pdf-color-extract.ts.
 * Stores one row per merged segment; color/type constrained by CHECK.
 */
/**
 * Append-only time-tracking for article review sessions.
 * One row = one contiguous open-review window per assignment.
 * Orphan sessions (end_at IS NULL, start_at < now - 90 min) are closed by a pg_cron watchdog.
 */
export const articleReviewSession = pgTable(
  "article_review_session",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    assignmentId: text("assignment_id").notNull().references(() => assignments.id, { onDelete: "cascade" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull().defaultNow(),
    endAt: timestamp("end_at", { withTimezone: true }),
    /** Reason this session was closed. NULL = still open. */
    closedReason: text("closed_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "closed_reason_check",
      sql`${t.closedReason} IS NULL OR ${t.closedReason} IN ('navigate','blur','submit','reopen','watchdog')`
    ),
    index("idx_session_assignment").on(t.assignmentId),
    // Partial index for fast open-session lookups (WHERE end_at IS NULL)
    index("idx_session_open").on(t.assignmentId).where(sql`${t.endAt} IS NULL`),
  ]
);

export const articleSegments = pgTable(
  "article_segments",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    articleId: text("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
    /** 0-based render order within the article */
    order: integer("order").notNull(),
    text: text("text").notNull(),
    /** "green" | "yellow" | "red" | "neutral" */
    color: text("color").notNull(),
    /** "highlight" | "badge" | "warning" | "score" | "text" */
    type: text("type").notNull(),
    /** Numeric score value when type="score" (e.g. 86.4), null otherwise */
    scoreValue: real("score_value"),
    /** 0-based source page index in the PDF */
    pageIndex: integer("page_index").notNull().default(0),
    createdAt: bigint("created_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
  },
  (t) => [
    check("seg_color_check", sql`${t.color} IN ('green','yellow','red','neutral')`),
    check("seg_type_check", sql`${t.type} IN ('highlight','badge','warning','score','text')`),
  ]
);

// ─── E3: Inline Comments + Claim Uncertainty (Round-9 prototype) ─────────────
//
// article_comments — expert inline annotations anchored to a text quote within a section.
//   Anchor resolution: hybrid (quote + prefix/suffix + offset fallback).
//
// claim_ratings — 3-way verdict per claim per assignment.
//   Toggle off = DELETE row (no verdict). unsure_ratio = COUNT FILTER WHERE verdict='unsure' / COUNT(*).

/**
 * Expert inline comment anchored to a specific text selection within an article section.
 * Anchor fields are redundant by design: quote+prefix+suffix for fuzzy re-match,
 * offset_{start,end} as numeric fallback when text shifts between renders.
 */
export const articleComments = pgTable(
  "article_comments",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    articleId: text("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
    assignmentId: text("assignment_id").notNull().references(() => assignments.id, { onDelete: "cascade" }),
    expertId: uuid("expert_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    /** 'sec-0' | 'sec-1' | 'sec-2' … — string index identifying the article section */
    sectionId: text("section_id").notNull(),
    /** Selected text content — primary key for hybrid anchor resolver */
    anchorQuote: text("anchor_quote").notNull(),
    /** ~30 chars immediately before anchorQuote */
    anchorPrefix: text("anchor_prefix"),
    /** ~30 chars immediately after anchorQuote */
    anchorSuffix: text("anchor_suffix"),
    /** Best-effort byte offset of anchorQuote start within section text (nullable fallback) */
    anchorOffsetStart: integer("anchor_offset_start"),
    anchorOffsetEnd: integer("anchor_offset_end"),
    /** Comment body — 1 to 2000 characters */
    body: text("body").notNull(),
    /** "open" | "resolved" */
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("article_comments_body_length_check", sql`length(${t.body}) > 0 AND length(${t.body}) <= 2000`),
    check("article_comments_status_check", sql`${t.status} IN ('open', 'resolved')`),
    index("idx_article_comments_article").on(t.articleId, t.sectionId),
    index("idx_article_comments_expert").on(t.expertId),
  ]
);

/**
 * 3-way verdict for an individual claim within an article section.
 * One row per (assignment, section, claim index). Delete row = no verdict (toggle off).
 * Admin unsure_ratio = COUNT(*) FILTER (WHERE verdict = 'unsure') / COUNT(*).
 */
export const claimRatings = pgTable(
  "claim_ratings",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    assignmentId: text("assignment_id").notNull().references(() => assignments.id, { onDelete: "cascade" }),
    expertId: uuid("expert_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    sectionId: text("section_id").notNull(),
    /** 0-based index of the claim within its section */
    claimIdx: integer("claim_idx").notNull(),
    /** "correct" | "incorrect" | "unsure" */
    verdict: text("verdict").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("claim_ratings_verdict_check", sql`${t.verdict} IN ('correct', 'incorrect', 'unsure')`),
    unique("claim_ratings_assignment_section_claim_unique").on(t.assignmentId, t.sectionId, t.claimIdx),
    index("idx_claim_ratings_assignment").on(t.assignmentId),
  ]
);
