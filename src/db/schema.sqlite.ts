/**
 * SQLite schema - local development mirror of the Postgres schema.
 *
 * All tables use sqliteTable / text / integer / real for SQLite compat.
 * UUIDs stored as text, timestamps as ISO strings.
 * Foreign keys enabled via drizzle.config pragma.
 */
import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

// ─── E1: Auth / User Management ──────────────────────────────────────

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  role: text("role", { enum: ["superadmin", "admin", "annotator"] }).notNull().default("annotator"),
  name: text("name"),
  image: text("image"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const expertProfiles = sqliteTable("expert_profiles", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  userId: text("user_id").notNull().unique().references(() => profiles.id, { onDelete: "cascade" }),
  domain: text("domain", { enum: ["law", "medical", "tourism", "safety_compliance"] }).notNull(),
  status: text("status", { enum: ["pending", "active", "inactive"] }).notNull().default("pending"),
  inviteToken: text("invite_token").unique(),
  inviteExpiresAt: integer("invite_expires_at", { mode: "number" }),
  invitedAt: integer("invited_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
  activatedAt: integer("activated_at", { mode: "number" }),
  createdAt: integer("created_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
  updatedAt: integer("updated_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
});

export const expertDomains = sqliteTable("expert_domains", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  userId: text("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  domain: text("domain", { enum: ["law", "medical", "tourism", "safety_compliance"] }).notNull(),
  createdAt: integer("created_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
});

export const expertSubDomains = sqliteTable(
  "expert_sub_domains",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    userId: text("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    subDomainId: text("sub_domain_id", {
      enum: [
        "law_01", "law_02", "law_03", "law_04", "law_05", "law_06", "law_07",
        "med_01", "med_02", "med_03", "med_04", "med_05", "med_06", "med_07",
        "trv_01", "trv_02", "trv_03", "trv_04", "trv_05", "trv_06", "trv_07", "trv_08",
        "saf_01",
      ],
    }).notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
  },
  (t) => [
    uniqueIndex("expert_sub_domains_user_sub_unique").on(t.userId, t.subDomainId),
    index("expert_sub_domains_user_idx").on(t.userId),
  ]
);

export const expertMedicalMicroDomains = sqliteTable(
  "expert_medical_micro_domains",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    userId: text("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    microDomainId: text("micro_domain_id").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
  },
  (t) => [
    uniqueIndex("expert_medical_micro_domains_user_micro_unique").on(t.userId, t.microDomainId),
    index("expert_medical_micro_domains_user_idx").on(t.userId),
  ]
);

// ─── E2: Article Management + Assignment ──────────────────────────────

export const batches = sqliteTable("batches", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  name: text("name").notNull(),
  domain: text("domain", { enum: ["law", "medical", "tourism", "safety_compliance"] }).notNull(),
  articleType: text("article_type", { enum: ["full", "paragraph"] }).notNull(),
  zipStorageKey: text("zip_r2_key").notNull(),
  totalArticles: integer("total_articles").notNull().default(0),
  errorFiles: text("error_files"),
  payRatePerArticle: integer("pay_rate_per_article").notNull().default(0),
  status: text("status", { enum: ["ready", "in_progress", "completed"] }).notNull().default("ready"),
  assignmentMode: text("assignment_mode", { enum: ["manual", "broadcast"] }).notNull().default("manual"),
  broadcastExpiresAt: text("broadcast_expires_at"),
  createdBy: text("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
  updatedAt: integer("updated_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
});

export const articles = sqliteTable("articles", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  batchId: text("batch_id").notNull().references(() => batches.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  type: text("type", { enum: ["full", "paragraph"] }).notNull(),
  pdfStorageKey: text("pdf_r2_key"),
  textContent: text("text_content"),
  sourceFormat: text("source_format", { enum: ["pdf", "json"] }).notNull().default("pdf"),
  sourceStorageKey: text("source_storage_key"),
  payloadJson: text("payload_json"),
  status: text("status", { enum: ["unassigned", "assigned", "in_review", "completed"] }).notNull().default("unassigned"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  disabledAt: text("disabled_at"),
  subDomainId: text("sub_domain_id"),
  medicalMicroDomainId: text("medical_micro_domain_id"),
  createdAt: integer("created_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
  updatedAt: integer("updated_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
});

export const articleParagraphs = sqliteTable("article_paragraphs", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  articleId: text("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  paragraphIndex: integer("paragraph_index").notNull(),
  text: text("text").notNull(),
  createdAt: integer("created_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
});

export const articleReviewSession = sqliteTable(
  "article_review_session",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    assignmentId: text("assignment_id").notNull(),
    startAt: text("start_at").notNull().$defaultFn(() => new Date().toISOString()),
    endAt: text("end_at"),
    closedReason: text("closed_reason"),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    index("idx_session_assignment").on(t.assignmentId),
  ]
);

export const articleSegments = sqliteTable("article_segments", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  articleId: text("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  order: integer("order").notNull(),
  text: text("text").notNull(),
  color: text("color", { enum: ["green", "yellow", "red", "neutral"] }).notNull(),
  type: text("type", { enum: ["highlight", "badge", "warning", "score", "text"] }).notNull(),
  scoreValue: real("score_value"),
  pageIndex: integer("page_index").notNull().default(0),
  createdAt: integer("created_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
});

export const assignments = sqliteTable(
  "assignments",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    articleId: text("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
    expertId: text("expert_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    payRate: integer("pay_rate").notNull().default(0),
    status: text("status", { enum: ["assigned", "in_review", "completed"] }).notNull().default("assigned"),
    assignedAt: integer("assigned_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
    completedAt: integer("completed_at", { mode: "number" }),
    createdAt: integer("created_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
  },
  (t) => [uniqueIndex("assignments_article_expert_unique").on(t.articleId, t.expertId)]
);

export const rubrics = sqliteTable("rubrics", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  name: text("name").notNull(),
  domain: text("domain", { enum: ["law", "medical", "tourism", "safety_compliance"] }).notNull(),
  createdBy: text("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
  updatedAt: integer("updated_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
});

export const rubricCriteria = sqliteTable("rubric_criteria", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  rubricId: text("rubric_id").notNull().references(() => rubrics.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  scale: text("scale").notNull(),
  required: integer("required").notNull().default(1),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
  updatedAt: integer("updated_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
});

// ─── E3: Inline Comments + Claim Uncertainty ──────────────────────────

export const articleComments = sqliteTable(
  "article_comments",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    articleId: text("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
    assignmentId: text("assignment_id").notNull(),
    expertId: text("expert_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    sectionId: text("section_id").notNull(),
    anchorQuote: text("anchor_quote").notNull(),
    anchorPrefix: text("anchor_prefix"),
    anchorSuffix: text("anchor_suffix"),
    anchorOffsetStart: integer("anchor_offset_start"),
    anchorOffsetEnd: integer("anchor_offset_end"),
    body: text("body").notNull(),
    status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    index("idx_article_comments_article").on(t.articleId, t.sectionId),
    index("idx_article_comments_expert").on(t.expertId),
  ]
);

export const claimRatings = sqliteTable(
  "claim_ratings",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    assignmentId: text("assignment_id").notNull(),
    expertId: text("expert_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    sectionId: text("section_id").notNull(),
    claimIdx: integer("claim_idx").notNull(),
    verdict: text("verdict", { enum: ["correct", "incorrect", "unsure"] }).notNull(),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    uniqueIndex("claim_ratings_assignment_section_claim_unique").on(t.assignmentId, t.sectionId, t.claimIdx),
    index("idx_claim_ratings_assignment").on(t.assignmentId),
  ]
);
