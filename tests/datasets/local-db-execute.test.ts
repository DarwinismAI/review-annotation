import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";

const previousLocalDbPath = process.env.LOCAL_DB_PATH;
const previousDatabaseUrl = process.env.DATABASE_URL;

async function run() {
  process.env.LOCAL_DB_PATH = `file:${join(mkdtempSync(join(tmpdir(), "sqlite-execute-")), "local.db")}`;
  delete process.env.DATABASE_URL;

  try {
    const { db } = await import("../../src/db/client");
    await db.run(sql`create table runtime_execute_dataset (id text primary key, name text not null)`);
    await db.run(sql`insert into runtime_execute_dataset (id, name) values ('dataset-1', 'Runtime Dataset')`);

    const result = await db.execute(sql`
      with runtime_rows as (
        select id, name from runtime_execute_dataset
      )
      select id, name from runtime_rows
    `);

    assert.deepEqual(result.rows, [{ id: "dataset-1", name: "Runtime Dataset" }]);
  } finally {
    if (previousLocalDbPath === undefined) delete process.env.LOCAL_DB_PATH;
    else process.env.LOCAL_DB_PATH = previousLocalDbPath;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
}

run().catch((error) => {
  throw error;
});
