/**
 * Assign up to N unique, same-domain articles to active experts.
 *
 * Intended for manual runs after new experts register:
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... pnpm tsx scripts/assign-new-experts-rest.ts
 *
 * Default behavior is idempotent top-up: each active expert gets at most 10
 * total assignments. Articles are never assigned to more than one expert by
 * this script because it only draws from enabled + unassigned articles.
 */
import { createClient } from "@supabase/supabase-js";
import { createId } from "@paralleldrive/cuid2";
import { DOMAIN_KEYS, type DomainKey } from "../src/lib/labels";

type Domain = DomainKey;

interface ExpertDomainRow {
  user_id: string;
  domain: Domain;
  profiles: {
    id: string;
    email: string;
    name: string | null;
    role: string;
    expert_profiles: Array<{ status: string }>;
  } | null;
}

interface ArticleRow {
  id: string;
  title: string;
  batch_id: string;
  batches: {
    id: string;
    domain: Domain;
    pay_rate_per_article: number | null;
  } | null;
}

interface AssignmentRow {
  id: string;
  article_id: string;
  expert_id: string;
  status: string;
}

interface ExpertCandidate {
  id: string;
  email: string;
  name: string;
  domains: Domain[];
  currentAssignments: number;
}

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

const limitPerExpert = Number(readArg("--limit") ?? process.env.ASSIGN_LIMIT ?? "10");
const dryRun = hasArg("--dry-run");

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY are required");
}
if (!Number.isInteger(limitPerExpert) || limitPerExpert < 1) {
  throw new Error("--limit must be a positive integer");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function readArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

async function loadExperts(): Promise<ExpertCandidate[]> {
  const { data, error } = await supabase
    .from("expert_domains")
    .select(
      "user_id,domain,profiles!inner(id,email,name,role,expert_profiles!inner(status))"
    )
    .eq("profiles.role", "annotator")
    .eq("profiles.expert_profiles.status", "active")
    .order("created_at", { ascending: true });

  if (error) throw error;

  const byExpert = new Map<string, ExpertCandidate>();
  for (const row of (data ?? []) as unknown as ExpertDomainRow[]) {
    if (!row.profiles) continue;
    const existing = byExpert.get(row.user_id);
    if (existing) {
      if (!existing.domains.includes(row.domain)) existing.domains.push(row.domain);
      continue;
    }
    byExpert.set(row.user_id, {
      id: row.user_id,
      email: row.profiles.email,
      name: row.profiles.name ?? row.profiles.email,
      domains: [row.domain],
      currentAssignments: 0,
    });
  }

  return [...byExpert.values()];
}

async function loadAssignments(): Promise<AssignmentRow[]> {
  const { data, error } = await supabase
    .from("assignments")
    .select("id,article_id,expert_id,status");
  if (error) throw error;
  return (data ?? []) as AssignmentRow[];
}

async function loadArticlePool(): Promise<Map<Domain, ArticleRow[]>> {
  const { data, error } = await supabase
    .from("articles")
    .select("id,title,batch_id,batches!inner(id,domain,pay_rate_per_article)")
    .eq("enabled", true)
    .eq("status", "unassigned")
    .order("created_at", { ascending: true });

  if (error) throw error;

  const pool = new Map<Domain, ArticleRow[]>(
    DOMAIN_KEYS.map((domain): [Domain, ArticleRow[]] => [domain, []]),
  );

  for (const article of (data ?? []) as unknown as ArticleRow[]) {
    if (!article.batches) continue;
    pool.get(article.batches.domain)?.push(article);
  }

  return pool;
}

async function assignArticles(expert: ExpertCandidate, articles: ArticleRow[]) {
  const now = Date.now();
  const rows = articles.map((article) => ({
    id: createId(),
    article_id: article.id,
    expert_id: expert.id,
    pay_rate: article.batches?.pay_rate_per_article ?? 0,
    status: "assigned",
    assigned_at: now,
    created_at: now,
    updated_at: now,
  }));

  const { error: insertError } = await supabase
    .from("assignments")
    .insert(rows);
  if (insertError) throw insertError;

  const articleIds = articles.map((a) => a.id);
  const { error: articleError } = await supabase
    .from("articles")
    .update({ status: "assigned", updated_at: now })
    .in("id", articleIds);
  if (articleError) throw articleError;

  const batchIds = [...new Set(articles.map((a) => a.batch_id))];
  const { error: batchError } = await supabase
    .from("batches")
    .update({ status: "in_progress", updated_at: now })
    .in("id", batchIds);
  if (batchError) throw batchError;
}

async function main() {
  const [experts, assignments, pool] = await Promise.all([
    loadExperts(),
    loadAssignments(),
    loadArticlePool(),
  ]);

  const assignmentsByExpert = new Map<string, number>();
  for (const assignment of assignments) {
    assignmentsByExpert.set(
      assignment.expert_id,
      (assignmentsByExpert.get(assignment.expert_id) ?? 0) + 1
    );
  }

  for (const expert of experts) {
    expert.currentAssignments = assignmentsByExpert.get(expert.id) ?? 0;
  }

  let totalPlanned = 0;
  let totalAssigned = 0;

  for (const expert of experts) {
    const missing = Math.max(0, limitPerExpert - expert.currentAssignments);
    if (missing === 0) {
      console.log(`skip ${expert.name} <${expert.email}> already_has=${expert.currentAssignments}`);
      continue;
    }

    const selected: ArticleRow[] = [];
    for (const domain of expert.domains) {
      const domainPool = pool.get(domain) ?? [];
      while (selected.length < missing && domainPool.length > 0) {
        const article = domainPool.shift();
        if (article) selected.push(article);
      }
      if (selected.length >= missing) break;
    }

    totalPlanned += selected.length;
    const domainSummary = selected.reduce<Record<string, number>>((acc, article) => {
      const domain = article.batches?.domain ?? "unknown";
      acc[domain] = (acc[domain] ?? 0) + 1;
      return acc;
    }, {});

    if (selected.length === 0) {
      console.log(
        `no_pool ${expert.name} <${expert.email}> domains=${expert.domains.join(",")} current=${expert.currentAssignments}`
      );
      continue;
    }

    if (dryRun) {
      console.log(
        `dry_run ${expert.name} <${expert.email}> assign=${selected.length} domains=${JSON.stringify(domainSummary)}`
      );
      continue;
    }

    await assignArticles(expert, selected);
    totalAssigned += selected.length;
    console.log(
      `assigned ${expert.name} <${expert.email}> count=${selected.length} domains=${JSON.stringify(domainSummary)}`
    );
  }

  console.log(
    `done experts=${experts.length} planned=${totalPlanned} assigned=${totalAssigned} dryRun=${dryRun}`
  );
}

main().catch((err) => {
  console.error("assign-new-experts-rest failed:", err);
  process.exit(1);
});
