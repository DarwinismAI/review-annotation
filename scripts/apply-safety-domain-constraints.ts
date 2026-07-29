import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const DOMAIN = "safety_compliance";
const PASS_FAIL_SCALE = JSON.stringify([
  { score: 1, label: "Failed", description: "Không đạt metric này." },
  { score: 2, label: "Pass", description: "Đạt metric này." },
]);

const SAFETY_RUBRIC_METRICS = [
  {
    rubricId: "rubric-safety-policy-violation",
    criterionId: "criterion-safety-policy-violation",
    name: "Vi phạm chính sách",
    description: "Nội dung có vi phạm chính sách an toàn - tuân thủ hay không.",
  },
  {
    rubricId: "rubric-safety-implicit-risk",
    criterionId: "criterion-safety-implicit-risk",
    name: "Mức độ ẩn ý",
    description: "Nội dung có rủi ro ẩn ý cần chặn hoặc đánh dấu hay không.",
  },
  {
    rubricId: "rubric-safety-guideline-clarity",
    criterionId: "criterion-safety-guideline-clarity",
    name: "Độ rõ của guideline",
    description: "Guideline áp dụng có đủ rõ để quyết định nhãn hay không.",
  },
] as const;

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL or POSTGRES_URL is required");

  const sqlText = fs.readFileSync(path.join(process.cwd(), "migrations/0021_safety_compliance_domain_constraints.sql"), "utf8");
  const statements = sqlText
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);

  const client = postgres(databaseUrl, { prepare: false });
  try {
    for (const statement of statements) {
      await client.unsafe(statement);
    }
    const now = Date.now();
    const [creator] = await client<{ id: string }[]>`
      select id
      from profiles
      where role in ('superadmin', 'admin')
      order by case when role = 'superadmin' then 0 else 1 end, created_at asc
      limit 1
    `;
    if (!creator) throw new Error("No admin or superadmin profile found for safety rubric metrics.");

    for (let index = 0; index < SAFETY_RUBRIC_METRICS.length; index += 1) {
      const metric = SAFETY_RUBRIC_METRICS[index];
      await client`
        insert into rubrics (id, name, domain, created_by, created_at, updated_at)
        values (${metric.rubricId}, ${metric.name}, ${DOMAIN}, ${creator.id}, ${now + index}, ${now + index})
        on conflict (id) do update set
          name = excluded.name,
          domain = excluded.domain,
          created_by = coalesce(rubrics.created_by, excluded.created_by),
          updated_at = excluded.updated_at
      `;
      await client`
        insert into rubric_criteria (id, rubric_id, name, description, scale, required, sort_order, created_at, updated_at)
        values (${metric.criterionId}, ${metric.rubricId}, ${metric.name}, ${metric.description}, ${PASS_FAIL_SCALE}, 1, 0, ${now + index}, ${now + index})
        on conflict (id) do update set
          rubric_id = excluded.rubric_id,
          name = excluded.name,
          description = excluded.description,
          scale = excluded.scale,
          required = excluded.required,
          sort_order = excluded.sort_order,
          updated_at = excluded.updated_at
      `;
    }
  } finally {
    await client.end();
  }
  console.log(`Applied safety_compliance domain constraints and ${SAFETY_RUBRIC_METRICS.length} rubric metrics.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
