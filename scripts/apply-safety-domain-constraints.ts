import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

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
  } finally {
    await client.end();
  }
  console.log("Applied safety_compliance domain constraints.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
