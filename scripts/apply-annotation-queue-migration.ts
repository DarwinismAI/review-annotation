import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const MIGRATION_PATHS = [
  "migrations/0022_annotation_queue_adjudication.sql",
  "migrations/0023_annotation_adjudication_security.sql",
] as const;
type QueryClient = postgres.Sql | postgres.TransactionSql;
const CONCURRENT_INDEX_SQL = [
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS annotation_assignments_group_queue_idx
     ON public.annotation_assignments (annotator_id, assignment_run_id, status, skipped_at, assigned_at)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS dataset_imports_dataset_status_idx
     ON public.dataset_imports (dataset_id, status, created_at DESC)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS annotation_adjudications_dataset_row_idx
     ON public.annotation_adjudications (dataset_id, row_id)`,
] as const;
const MONITORED_TABLES = [
  "datasets",
  "dataset_rows",
  "annotation_assignments",
  "annotation_results",
  "annotation_metrics",
  "annotation_assignment_runs",
  "dataset_imports",
] as const;

const REQUIRED_COLUMNS = [
  { table: "annotation_assignments", column: "skipped_at", dataType: "timestamp with time zone", isNullable: "YES", columnDefault: null },
  { table: "annotation_assignments", column: "skip_count", dataType: "integer", isNullable: "NO", columnDefault: "0" },
  { table: "dataset_imports", column: "target_row_count", dataType: "integer", isNullable: "YES", columnDefault: null },
  { table: "dataset_imports", column: "error_message", dataType: "text", isNullable: "YES", columnDefault: null },
  { table: "dataset_imports", column: "started_at", dataType: "timestamp with time zone", isNullable: "YES", columnDefault: null },
  { table: "dataset_imports", column: "completed_at", dataType: "timestamp with time zone", isNullable: "YES", columnDefault: null },
  { table: "annotation_adjudications", column: "id", dataType: "text", isNullable: "NO", columnDefault: null },
  { table: "annotation_adjudications", column: "dataset_id", dataType: "text", isNullable: "NO", columnDefault: null },
  { table: "annotation_adjudications", column: "row_id", dataType: "text", isNullable: "NO", columnDefault: null },
  { table: "annotation_adjudications", column: "metric_id", dataType: "text", isNullable: "NO", columnDefault: null },
  { table: "annotation_adjudications", column: "metric_key", dataType: "text", isNullable: "NO", columnDefault: null },
  { table: "annotation_adjudications", column: "reviewer_id", dataType: "uuid", isNullable: "YES", columnDefault: null },
  { table: "annotation_adjudications", column: "value", dataType: "text", isNullable: "YES", columnDefault: null },
  { table: "annotation_adjudications", column: "note", dataType: "text", isNullable: "YES", columnDefault: null },
  { table: "annotation_adjudications", column: "created_at", dataType: "timestamp with time zone", isNullable: "NO", columnDefault: "now()" },
  { table: "annotation_adjudications", column: "updated_at", dataType: "timestamp with time zone", isNullable: "NO", columnDefault: "now()" },
  { table: "annotation_adjudications", column: "submitted_at", dataType: "timestamp with time zone", isNullable: "NO", columnDefault: "now()" },
] as const;

const REQUIRED_INDEXES = [
  { name: "annotation_assignments_group_queue_idx", table: "annotation_assignments", columns: ["annotator_id", "assignment_run_id", "status", "skipped_at", "assigned_at"] },
  { name: "dataset_imports_dataset_status_idx", table: "dataset_imports", columns: ["dataset_id", "status", "created_at DESC"] },
  { name: "annotation_adjudications_dataset_row_idx", table: "annotation_adjudications", columns: ["dataset_id", "row_id"] },
  { name: "annotation_adjudications_row_metric_unique", table: "annotation_adjudications", columns: ["row_id", "metric_id"], unique: true },
] as const;

const REQUIRED_CONSTRAINTS = [
  { name: "annotation_adjudications_pkey", table: "annotation_adjudications", type: "primary key", columns: ["id"] },
  { name: "annotation_adjudications_row_metric_unique", table: "annotation_adjudications", type: "unique", columns: ["row_id", "metric_id"] },
  { table: "annotation_adjudications", type: "foreign key", columns: ["dataset_id"], foreignTable: "datasets", foreignColumns: ["id"], deleteAction: "CASCADE" },
  { table: "annotation_adjudications", type: "foreign key", columns: ["row_id"], foreignTable: "dataset_rows", foreignColumns: ["id"], deleteAction: "CASCADE" },
  { table: "annotation_adjudications", type: "foreign key", columns: ["metric_id"], foreignTable: "annotation_metrics", foreignColumns: ["id"], deleteAction: "CASCADE" },
  { table: "annotation_adjudications", type: "foreign key", columns: ["reviewer_id"], foreignTable: "profiles", foreignColumns: ["id"], deleteAction: "SET NULL" },
] as const;

function resolveDatabaseUrl(): string {
  const databaseUrl =
    process.env.PROD_DATABASE_URL ??
    process.env.DATABASE_URL ??
    process.env.PROD_POSTGRES_URL ??
    process.env.POSTGRES_URL;
  if (!databaseUrl) {
    throw new Error("Missing production database URL secret");
  }
  return databaseUrl;
}

function quotedIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function tableExists(client: QueryClient, table: string): Promise<boolean> {
  const [{ exists }] = await client`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = ${table}
    ) as exists
  `;
  return Boolean(exists);
}

async function readTableCount(client: QueryClient, table: string): Promise<bigint> {
  const [row] = await client.unsafe<{ total: string }[]>(`select count(*)::text as total from public.${quotedIdentifier(table)}`);
  return BigInt(row.total);
}

async function readOptionalTableCount(client: QueryClient, table: string): Promise<{ exists: boolean; total: bigint }> {
  const exists = await tableExists(client, table);
  return { exists, total: exists ? await readTableCount(client, table) : BigInt(0) };
}

async function readCounts(client: QueryClient): Promise<Map<string, bigint>> {
  const counts = new Map<string, bigint>();
  for (const table of MONITORED_TABLES) {
    counts.set(table, await readTableCount(client, table));
  }
  return counts;
}

function assertCountsEqual(before: Map<string, bigint>, after: Map<string, bigint>) {
  for (const table of MONITORED_TABLES) {
    if (before.get(table) !== after.get(table)) {
      throw new Error(`Aggregate row-count invariant mismatch for ${table}`);
    }
  }
}

function normalizeDefault(value: string | null): string | null {
  if (value === null) return null;
  if (value === "0" || value === "now()") return value;
  if (value.startsWith("0::")) return "0";
  if (value.startsWith("now(")) return "now()";
  return value;
}

async function verifyRequiredCatalog(client: QueryClient, options: { includeIndexes: boolean } = { includeIndexes: true }) {
  if (!(await tableExists(client, "annotation_adjudications"))) {
    throw new Error("Missing required table annotation_adjudications");
  }

  for (const expected of REQUIRED_COLUMNS) {
    const [actual] = await client<{ data_type: string; is_nullable: string; column_default: string | null }[]>`
      select data_type, is_nullable, column_default
        from information_schema.columns
        where table_schema = 'public'
          and table_name = ${expected.table}
          and column_name = ${expected.column}
    `;
    if (!actual) {
      throw new Error(`Missing required column ${expected.table}.${expected.column}`);
    }
    if (
      actual.data_type !== expected.dataType ||
      actual.is_nullable !== expected.isNullable ||
      normalizeDefault(actual.column_default) !== expected.columnDefault
    ) {
      throw new Error(`Invalid column contract ${expected.table}.${expected.column}`);
    }
  }

  if (options.includeIndexes) {
    for (const expected of REQUIRED_INDEXES) {
      const rows = await client<{ column_name: string; is_desc: boolean; is_unique: boolean }[]>`
        select a.attname as column_name, (i.indoption[s.ordinality - 1] & 1) = 1 as is_desc, i.indisunique as is_unique
        from pg_class idx
        join pg_index i on i.indexrelid = idx.oid
        join pg_class tbl on tbl.oid = i.indrelid
        join pg_namespace n on n.oid = tbl.relnamespace
        join lateral unnest(i.indkey) with ordinality as s(attnum, ordinality) on true
        join pg_attribute a on a.attrelid = tbl.oid and a.attnum = s.attnum
        where n.nspname = 'public'
          and tbl.relname = ${expected.table}
          and idx.relname = ${expected.name}
        order by s.ordinality
      `;
      const actualColumns = rows.map((row) => `${row.column_name}${row.is_desc ? " DESC" : ""}`);
      if (
        actualColumns.join(",") !== expected.columns.join(",") ||
        ("unique" in expected && Boolean(rows[0]?.is_unique) !== expected.unique)
      ) {
        throw new Error(`Invalid index contract ${expected.name}`);
      }
    }
  }

  for (const expected of REQUIRED_CONSTRAINTS) {
    const expectedName = "name" in expected ? expected.name : null;
    const expectedType = expected.type === "primary key" ? "p" : expected.type === "unique" ? "u" : "f";
    const constraintCandidates = await client<{ constraint_name: string; columns: string[]; foreign_table: string | null; foreign_columns: string[] | null; delete_action: string | null }[]>`
      select
        con.conname as constraint_name,
        array_agg(cols.attname order by key_position.ordinality) as columns,
        foreign_table.relname as foreign_table,
        array_agg(foreign_cols.attname order by foreign_key_position.ordinality) filter (where foreign_cols.attname is not null) as foreign_columns,
        case con.confdeltype when 'c' then 'CASCADE' when 'n' then 'SET NULL' else null end as delete_action
      from pg_constraint con
      join pg_class tbl on tbl.oid = con.conrelid
      join pg_namespace ns on ns.oid = tbl.relnamespace
      join lateral unnest(con.conkey) with ordinality as key_position(attnum, ordinality) on true
      join pg_attribute cols on cols.attrelid = tbl.oid and cols.attnum = key_position.attnum
      left join pg_class foreign_table on foreign_table.oid = con.confrelid
      left join lateral unnest(con.confkey) with ordinality as foreign_key_position(attnum, ordinality) on foreign_key_position.ordinality = key_position.ordinality
      left join pg_attribute foreign_cols on foreign_cols.attrelid = con.confrelid and foreign_cols.attnum = foreign_key_position.attnum
      where ns.nspname = 'public'
        and tbl.relname = ${expected.table}
        and con.contype = ${expectedType}
        and (${expectedName}::text is null or con.conname = ${expectedName})
      group by con.conname, foreign_table.relname, con.confdeltype
    `;
    const constraint = constraintCandidates.find((candidate) => {
      if (candidate.columns.join(",") !== expected.columns.join(",")) return false;
      if (!("foreignTable" in expected)) return true;
      return (
        candidate.foreign_table === expected.foreignTable &&
        (candidate.foreign_columns ?? []).join(",") === expected.foreignColumns.join(",") &&
        candidate.delete_action === expected.deleteAction
      );
    });
    if (!constraint) {
      throw new Error(`Invalid constraint contract ${expected.table} ${expected.type}`);
    }
  }
}

async function verifyAdjudicationSecurity(client: QueryClient) {
  const [rls] = await client<{ relrowsecurity: boolean }[]>`
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'annotation_adjudications'
  `;
  if (!rls?.relrowsecurity) {
    throw new Error("annotation_adjudications RLS must be enabled");
  }

  const grants = await client<{ grantee: string; privilege_type: string }[]>`
    select grantee, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'annotation_adjudications'
      and grantee in ('anon', 'authenticated')
  `;
  if (grants.length > 0) {
    throw new Error("annotation_adjudications direct anon/authenticated grants must be revoked");
  }
}

async function main() {
  const databaseUrl = resolveDatabaseUrl();
  const migrationSql = MIGRATION_PATHS.map((migrationPath) => fs.readFileSync(path.join(process.cwd(), migrationPath), "utf8")).join("\n\n");
  const client = postgres(databaseUrl, { prepare: false });

  try {
    await client.begin(async (tx) => {
      const beforeCounts = await readCounts(tx);
      const beforeAdjudications = await readOptionalTableCount(tx, "annotation_adjudications");
      await tx.unsafe(migrationSql);
      await verifyRequiredCatalog(tx, { includeIndexes: false });
      await verifyAdjudicationSecurity(tx);
      const afterCounts = await readCounts(tx);
      const afterAdjudications = await readOptionalTableCount(tx, "annotation_adjudications");
      assertCountsEqual(beforeCounts, afterCounts);
      if (afterAdjudications.total !== beforeAdjudications.total) {
        throw new Error("Aggregate row-count invariant mismatch for annotation_adjudications");
      }
      if (!beforeAdjudications.exists && afterAdjudications.total !== BigInt(0)) {
        throw new Error("annotation_adjudications must be empty on first creation");
      }
    });
    for (const statement of CONCURRENT_INDEX_SQL) {
      await client.unsafe(statement);
    }
    await verifyRequiredCatalog(client);
    await verifyAdjudicationSecurity(client);
  } finally {
    await client.end();
  }

  console.log("Aggregate row-count invariants verified.");
  console.log("Annotation queue migration gate completed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Annotation queue migration gate failed");
  process.exit(1);
});
