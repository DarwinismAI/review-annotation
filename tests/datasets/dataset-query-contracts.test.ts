import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";

const datasetsRoute = readFileSync("src/app/api/datasets/route.ts", "utf8");
const membersRoute = readFileSync("src/app/api/admin/members/route.ts", "utf8");
const rubricsRoute = readFileSync("src/app/api/rubrics/route.ts", "utf8");
const taskGroupsRoute = readFileSync("src/app/api/annotator/task-groups/route.ts", "utf8");
const taskGroupsRead = readFileSync("src/lib/datasets/task-groups-read.ts", "utf8");
const pgSchema = readFileSync("src/db/schema.ts", "utf8");
const sqliteSchema = readFileSync("src/db/schema.sqlite.ts", "utf8");
const pgDatasetsSchema = readFileSync("src/db/datasets.ts", "utf8");
const sqliteDatasetsSchema = readFileSync("src/db/datasets.sqlite.ts", "utf8");
const dashboardRoutePath = "src/app/api/admin/dashboard/route.ts";

assert.match(datasetsRoute, /db\.execute\(\s*sql`[\s\S]*page_datasets/i);
assert.match(datasetsRoute, /dataset_total/i);
assert.match(datasetsRoute, /summary_totals/i);
assert.doesNotMatch(datasetsRoute, /Promise\.all\(\[[\s\S]*?db\s*\.select\(\{\s*total:\s*count\(\)\s*\}\)\.from\(datasetRows\)/);
assert.doesNotMatch(datasetsRoute, /rawJson:\s*datasetRows\.rawJson/);

assert.equal(existsSync(dashboardRoutePath), true);
const dashboardRoute = readFileSync(dashboardRoutePath, "utf8");
assert.match(dashboardRoute, /GET\s*=\s*requireAdmin/);
assert.match(dashboardRoute, /db\.execute\(\s*sql`[\s\S]*recent_datasets/i);
assert.match(dashboardRoute, /const queryGlobalTotals = async \(\)/);
assert.match(dashboardRoute, /const queryRecentDatasets = async \(\)/);
assert.doesNotMatch(dashboardRoute, /const queryDashboard = async \(\)/);
assert.match(dashboardRoute, /context\.timing\.measure\("sql",\s*\(\) =>\s*Promise\.all\(\[\s*queryGlobalTotals\(\),\s*queryRecentDatasets\(\),\s*\]\),?\s*\)/);
assert.equal((dashboardRoute.match(/await db\.execute\(sql`/g) ?? []).length, 2);
assert.match(dashboardRoute, /activeAnnotators/);
assert.match(dashboardRoute, /totals/);
assert.match(dashboardRoute, /readyDatasets/);
assert.match(dashboardRoute, /importingDatasets/);
assert.match(dashboardRoute, /dataset_status_totals/);
assert.match(dashboardRoute, /count\(\*\)\s+as\s+dataset_count/);
assert.match(dashboardRoute, /sum\(case when status = 'ready' then 1 else 0 end\)/);
assert.match(dashboardRoute, /sum\(case when status = 'importing' then 1 else 0 end\)/);
assert.doesNotMatch(dashboardRoute, /\(select count\(\*\) from datasets\) as dataset_count/);
assert.doesNotMatch(dashboardRoute, /\(select count\(\*\) from datasets where status = 'ready'\) as ready_datasets/);
assert.doesNotMatch(dashboardRoute, /\(select count\(\*\) from datasets where status = 'importing'\) as importing_datasets/);
assert.match(dashboardRoute, /status\s*=\s*'ready'/);
assert.match(dashboardRoute, /status\s*=\s*'importing'/);
assert.match(dashboardRoute, /select\s+count\(\*\)[\s\S]*from profiles p[\s\S]*where p\.role in \('annotator', 'expert'\)[\s\S]*exists\s*\([\s\S]*from expert_profiles ep[\s\S]*ep\.user_id = p\.id[\s\S]*ep\.status = 'active'/i);
assert.doesNotMatch(dashboardRoute, /count\(distinct p\.id\)/i);
assert.doesNotMatch(dashboardRoute, /inner join expert_profiles ep on ep\.user_id = p\.id/i);
assert.doesNotMatch(dashboardRoute, /from annotation_assignments[\s\S]*active_annotators/i);
assert.match(dashboardRoute, /SUPERADMIN_EMAILS/);
assert.match(dashboardRoute, /not\s+in/i);
assert.doesNotMatch(dashboardRoute, /where p\.role in \('annotator', 'expert'\) and ep\.status = 'active'/);
assert.doesNotMatch(dashboardRoute, /fetch\(/);
assert.doesNotMatch(dashboardRoute, /\/api\/datasets/);
assert.doesNotMatch(dashboardRoute, /\/api\/admin\/members/);

assert.doesNotMatch(membersRoute, /Promise\.all/);
assert.doesNotMatch(membersRoute, /db\.select\(\)\.from\(profiles\)/);
assert.match(membersRoute, /orderBy\(/);

assert.doesNotMatch(rubricsRoute, /Promise\.all/);
assert.doesNotMatch(rubricsRoute, /db\.select\(\)\.from\(rubrics\)/);
assert.match(rubricsRoute, /leftJoin\(rubricCriteria/);

assert.match(taskGroupsRoute, /GET\s*=\s*requireAnnotatorRead\(async \(_req,\s*claims,\s*context\)/);
assert.match(taskGroupsRoute, /context\.timing\.measure\("sql"/);
assert.match(taskGroupsRoute, /listTaskGroupsForAnnotator\(db,\s*claims\.user\.id\)/);
assert.match(taskGroupsRead, /metricLabels/);
assert.match(taskGroupsRead, /jsonb_array_elements_text/);
assert.match(taskGroupsRead, /allMetricIds/);
assert.match(taskGroupsRead, /inArray/);
assert.match(pgSchema, /userId: uuid\("user_id"\)\.notNull\(\)\.unique\(\)\.references\(\(\) => profiles\.id/);
assert.match(sqliteSchema, /userId: text\("user_id"\)\.notNull\(\)\.unique\(\)\.references\(\(\) => profiles\.id/);
assert.match(pgDatasetsSchema, /index\("annotation_assignments_annotator_idx"\)\.on\(t\.annotatorId\)/);
assert.match(sqliteDatasetsSchema, /index\("annotation_assignments_annotator_idx"\)\.on\(t\.annotatorId\)/);

type ProfileFixture = {
  id: string;
  email: string;
  role: "superadmin" | "admin" | "annotator" | "expert";
};

type ExpertProfileFixture = {
  userId: string;
  status: "pending" | "active" | "inactive";
};

function countActiveAnnotatorsJoinDistinct(
  profiles: ProfileFixture[],
  expertProfiles: ExpertProfileFixture[],
  excludedEmails: Set<string>,
) {
  const counted = new Set<string>();
  for (const profile of profiles) {
    for (const expertProfile of expertProfiles) {
      if (
        expertProfile.userId === profile.id &&
        expertProfile.status === "active" &&
        (profile.role === "annotator" || profile.role === "expert") &&
        !excludedEmails.has(profile.email.toLowerCase())
      ) {
        counted.add(profile.id);
      }
    }
  }
  return counted.size;
}

function countActiveAnnotatorsExists(
  profiles: ProfileFixture[],
  expertProfiles: ExpertProfileFixture[],
  excludedEmails: Set<string>,
) {
  return profiles.filter((profile) => {
    if (profile.role !== "annotator" && profile.role !== "expert") return false;
    if (excludedEmails.has(profile.email.toLowerCase())) return false;
    return expertProfiles.some((expertProfile) => expertProfile.userId === profile.id && expertProfile.status === "active");
  }).length;
}

const profileFixtures: ProfileFixture[] = [
  { id: "ann-active-with-duplicates", email: "active@example.com", role: "annotator" },
  { id: "ann-active-zero-assignments", email: "zero@example.com", role: "annotator" },
  { id: "ann-pending", email: "pending@example.com", role: "annotator" },
  { id: "ann-inactive", email: "inactive@example.com", role: "annotator" },
  { id: "admin-active", email: "admin@example.com", role: "admin" },
  { id: "super-active", email: "owner@example.com", role: "superadmin" },
];
const expertProfileFixtures: ExpertProfileFixture[] = [
  { userId: "ann-active-with-duplicates", status: "active" },
  { userId: "ann-active-with-duplicates", status: "active" },
  { userId: "ann-active-zero-assignments", status: "active" },
  { userId: "ann-pending", status: "pending" },
  { userId: "ann-inactive", status: "inactive" },
  { userId: "admin-active", status: "active" },
  { userId: "super-active", status: "active" },
];
const excludedEmails = new Set(["owner@example.com"]);

assert.equal(countActiveAnnotatorsJoinDistinct(profileFixtures, expertProfileFixtures, excludedEmails), 2);
assert.equal(
  countActiveAnnotatorsExists(profileFixtures, expertProfileFixtures, excludedEmails),
  countActiveAnnotatorsJoinDistinct(profileFixtures, expertProfileFixtures, excludedEmails),
);

async function assertSqliteActiveAnnotatorEquivalence() {
  const client = createClient({ url: `file:${join(mkdtempSync(join(tmpdir(), "dashboard-active-annotators-")), "local.db")}` });
  try {
    await client.execute(`create table profiles (id text primary key, email text not null unique, role text not null)`);
    await client.execute(`create table expert_profiles (id text primary key, user_id text not null unique, status text not null)`);
    await client.execute(`create table annotation_assignments (id text primary key, annotator_id text not null, status text not null)`);
    await client.batch([
      {
        sql: `insert into profiles (id, email, role) values
          ('ann-duplicate-assignments', 'active@example.com', 'annotator'),
          ('ann-zero-assignments', 'zero@example.com', 'annotator'),
          ('ann-pending', 'pending@example.com', 'annotator'),
          ('ann-inactive', 'inactive@example.com', 'annotator'),
          ('admin-active', 'admin@example.com', 'admin'),
          ('super-active', 'owner@example.com', 'superadmin')`,
        args: [],
      },
      {
        sql: `insert into expert_profiles (id, user_id, status) values
          ('ep-1', 'ann-duplicate-assignments', 'active'),
          ('ep-2', 'ann-zero-assignments', 'active'),
          ('ep-3', 'ann-pending', 'pending'),
          ('ep-4', 'ann-inactive', 'inactive'),
          ('ep-5', 'admin-active', 'active'),
          ('ep-6', 'super-active', 'active')`,
        args: [],
      },
      {
        sql: `insert into annotation_assignments (id, annotator_id, status) values
          ('a-1', 'ann-duplicate-assignments', 'assigned'),
          ('a-2', 'ann-duplicate-assignments', 'completed'),
          ('a-3', 'ann-duplicate-assignments', 'skipped'),
          ('a-4', 'admin-active', 'assigned')`,
        args: [],
      },
    ]);

    const legacy = await client.execute(`
      select count(distinct p.id) as active_annotators
      from profiles p
      inner join expert_profiles ep on ep.user_id = p.id
      where ep.status = 'active'
        and p.role in ('annotator', 'expert')
        and lower(p.email) not in ('owner@example.com')
    `);
    const optimized = await client.execute(`
      select count(*) as active_annotators
      from profiles p
      where p.role in ('annotator', 'expert')
        and lower(p.email) not in ('owner@example.com')
        and exists (
          select 1
          from expert_profiles ep
          where ep.user_id = p.id and ep.status = 'active'
        )
    `);

    assert.equal(Number(legacy.rows[0]?.active_annotators), 2);
    assert.deepEqual(optimized.rows, legacy.rows);
  } finally {
    client.close();
  }
}

assertSqliteActiveAnnotatorEquivalence().catch((error) => {
  throw error;
});
