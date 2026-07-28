import { and, asc, eq, inArray } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { db as defaultDb } from "@/db/client";
import {
  assignments,
  articles,
  batches,
  expertDomains,
  expertMedicalMicroDomains,
  expertProfiles,
  expertSubDomains,
  profiles,
} from "@/db/schema";

interface ExpertCandidate {
  id: string;
  name: string;
  subDomainIds: Set<string>;
  medicalMicroDomainIds: Set<string>;
  currentAssignments: number;
  plannedAssignments: number;
}

const SUB_DOMAIN_PREFIX_BY_DOMAIN: Record<string, string> = {
  law: "law_",
  medical: "med_",
  tourism: "trv_",
  safety_compliance: "saf_",
};

/** Mirrors broadcast sub-domain matching while choosing only one expert per article. */
function expertMatchesArticle(
  expert: ExpertCandidate,
  domain: string,
  subDomainId: string | null,
  medicalMicroDomainId: string | null
): boolean {
  const prefix = SUB_DOMAIN_PREFIX_BY_DOMAIN[domain];
  const narrowed = prefix ? [...expert.subDomainIds].filter((id) => id.startsWith(prefix)) : [];
  if (!(narrowed.length === 0 || subDomainId == null || narrowed.includes(subDomainId))) {
    return false;
  }

  if (domain !== "medical" || !medicalMicroDomainId) return true;
  const parentSubDomainId = subDomainId ?? medicalMicroDomainId.slice(0, 6);
  const narrowedMicros = [...expert.medicalMicroDomainIds].filter(
    (id) => id.slice(0, 6) === parentSubDomainId
  );
  return narrowedMicros.length === 0 || narrowedMicros.includes(medicalMicroDomainId);
}

function chooseLeastLoadedExpert(
  article: { subDomainId: string | null; medicalMicroDomainId: string | null },
  domain: string,
  experts: ExpertCandidate[]
) {
  return experts
    .filter((expert) => expertMatchesArticle(expert, domain, article.subDomainId, article.medicalMicroDomainId))
    .sort((a, b) => {
      const loadA = a.currentAssignments + a.plannedAssignments;
      const loadB = b.currentAssignments + b.plannedAssignments;
      return loadA - loadB || a.name.localeCompare(b.name);
    })[0] ?? null;
}

/**
 * Atomically claim one still-unassigned article for one expert.
 * The article row is updated inside the same transaction before inserting the
 * assignment, so two operators cannot assign the same article to two experts.
 */
export async function claimArticleForExpert({
  articleId,
  expertId,
  batchId,
  payRate,
  now = Date.now(),
  db = defaultDb,
}: {
  articleId: string;
  expertId: string;
  batchId: string;
  payRate: number;
  now?: number;
  db?: typeof defaultDb;
}): Promise<{ status: "assigned" | "skipped"; assignmentId?: string; reason?: string }> {
  const assignmentId = createId();
  let assigned = false;

  try {
    await db.transaction(async (tx: typeof defaultDb) => {
      const claimed = await tx
        .update(articles)
        .set({ status: "assigned", updatedAt: now })
        .where(
          and(
            eq(articles.id, articleId),
            eq(articles.batchId, batchId),
            eq(articles.status, "unassigned"),
            eq(articles.enabled, true)
          )
        )
        .returning({ id: articles.id });

      if (!claimed?.length) return;

      await tx.insert(assignments).values({
        id: assignmentId,
        articleId,
        expertId,
        payRate,
        status: "assigned",
        assignedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      assigned = true;
    });
  } catch (err) {
    console.error(`[batch-auto-assign] failed article=${articleId} expert=${expertId}:`, err);
    return { status: "skipped", reason: "Không thể phân công bài này" };
  }

  return assigned
    ? { status: "assigned", assignmentId }
    : { status: "skipped", reason: "Bài đã được phân công hoặc đã bị tắt" };
}

async function loadActiveExpertsForDomain(domain: string, db = defaultDb): Promise<ExpertCandidate[]> {
  const rows = await db
    .select({ userId: expertDomains.userId, name: profiles.name, email: profiles.email })
    .from(expertDomains)
    .innerJoin(expertProfiles, eq(expertProfiles.userId, expertDomains.userId))
    .innerJoin(profiles, eq(profiles.id, expertDomains.userId))
    .where(and(eq(expertDomains.domain, domain), eq(expertProfiles.status, "active")));

  const experts = new Map<string, ExpertCandidate>();
  for (const row of rows) {
    if (!experts.has(row.userId)) {
      experts.set(row.userId, {
        id: row.userId,
        name: row.name ?? row.email ?? row.userId,
        subDomainIds: new Set<string>(),
        medicalMicroDomainIds: new Set<string>(),
        currentAssignments: 0,
        plannedAssignments: 0,
      });
    }
  }

  const ids = [...experts.keys()];
  if (ids.length === 0) return [];

  const [subRows, medicalMicroRows, assignmentRows] = await Promise.all([
    db
      .select({ userId: expertSubDomains.userId, subDomainId: expertSubDomains.subDomainId })
      .from(expertSubDomains)
      .where(inArray(expertSubDomains.userId, ids)),
    domain === "medical"
      ? db
          .select({
            userId: expertMedicalMicroDomains.userId,
            microDomainId: expertMedicalMicroDomains.microDomainId,
          })
          .from(expertMedicalMicroDomains)
          .where(inArray(expertMedicalMicroDomains.userId, ids))
      : Promise.resolve([]),
    db.select({ expertId: assignments.expertId }).from(assignments).where(inArray(assignments.expertId, ids)),
  ]);

  for (const row of subRows) experts.get(row.userId)?.subDomainIds.add(row.subDomainId);
  for (const row of medicalMicroRows) experts.get(row.userId)?.medicalMicroDomainIds.add(row.microDomainId);
  for (const row of assignmentRows) {
    const expert = experts.get(row.expertId);
    if (expert) expert.currentAssignments += 1;
  }

  return [...experts.values()];
}

/** Auto-distribute enabled, unassigned articles in one batch to active matching experts. */
export async function assignBatchArticlesToExperts(
  batch: { id: string; domain: string; payRatePerArticle: number },
  db = defaultDb
) {
  const articleRows = await db
    .select({
      id: articles.id,
      title: articles.title,
      subDomainId: articles.subDomainId,
      medicalMicroDomainId: articles.medicalMicroDomainId,
    })
    .from(articles)
    .where(and(eq(articles.batchId, batch.id), eq(articles.status, "unassigned"), eq(articles.enabled, true)))
    .orderBy(asc(articles.createdAt));

  const experts = await loadActiveExpertsForDomain(batch.domain, db);
  if (articleRows.length === 0 || experts.length === 0) {
    return {
      results: [],
      summary: { assigned: 0, skipped: articleRows.length, availableArticles: articleRows.length, experts: experts.length },
    };
  }

  const now = Date.now();
  const results = [];
  for (const article of articleRows) {
    const expert = chooseLeastLoadedExpert(article, batch.domain, experts);
    if (!expert) {
      results.push({ articleId: article.id, status: "skipped", reason: "Không có chuyên gia phù hợp sub-domain" });
      continue;
    }

    const result = await claimArticleForExpert({
      articleId: article.id,
      expertId: expert.id,
      batchId: batch.id,
      payRate: batch.payRatePerArticle,
      now,
      db,
    });

    if (result.status === "assigned") expert.plannedAssignments += 1;
    results.push({ articleId: article.id, expertId: expert.id, expertName: expert.name, ...result });
  }

  const assigned = results.filter((r) => r.status === "assigned").length;
  if (assigned > 0) {
    await db.update(batches).set({ status: "in_progress", updatedAt: now }).where(eq(batches.id, batch.id));
  }

  return {
    results,
    summary: { assigned, skipped: results.length - assigned, availableArticles: articleRows.length, experts: experts.length },
  };
}
