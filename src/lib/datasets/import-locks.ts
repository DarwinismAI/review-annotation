import { sql } from "drizzle-orm";

function canUsePostgresLocks() {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  return Boolean(url?.trim());
}

export async function lockDatasetImportDomain(tx: any, domain: string) {
  if (!canUsePostgresLocks()) return;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`dataset-import-domain:${domain}`}))`);
}

export async function lockDatasetImportRun(tx: any, importId: string) {
  if (!canUsePostgresLocks()) return;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`dataset-import-run:${importId}`}))`);
}
