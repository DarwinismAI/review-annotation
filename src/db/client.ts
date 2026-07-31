/**
 * Drizzle db singleton - dual-driver with normalized raw-SQL API.
 * - LOCAL_DB_PATH set → SQLite (@libsql/client) for local dev
 * - DATABASE_URL set    → PostgreSQL (postgres-js) for production
 *
 * All drivers expose a uniform `.execute(sql)` method returning
 * `{ rows: any[] }` so that raw-SQL route handlers work unchanged.
 */
import * as schema from "./schema";
import * as reviewsSchema from "./reviews";
import * as timeEventsSchema from "./time-events";
import * as compensationSurveySchema from "./compensation-survey";
import * as datasetsSchema from "./datasets";
import * as schemaSqlite from "./schema.sqlite";
import * as reviewsSqlite from "./reviews.sqlite";
import * as timeEventsSqlite from "./time-events.sqlite";
import * as compensationSurveySqlite from "./compensation-survey.sqlite";
import * as datasetsSqlite from "./datasets.sqlite";

export { articleReviewSession } from "./schema";

function getDb() {
  const localPath = process.env.LOCAL_DB_PATH;

  if (localPath) {
    // ── SQLite via @libsql/client ──────────────────────────────────
    const { createClient } = require("@libsql/client");
    const { drizzle } = require("drizzle-orm/libsql");
    const { SQLiteAsyncDialect } = require("drizzle-orm/sqlite-core");
    const client = createClient({ url: localPath });
    const allSqliteSchema = { ...schemaSqlite, ...reviewsSqlite, ...timeEventsSqlite, ...compensationSurveySqlite, ...datasetsSqlite };
    const db = drizzle(client, { schema: allSqliteSchema }) as any;
    const sqliteDialect = new SQLiteAsyncDialect();

    // Polyfill: db.execute(sql) → { rows: any[] }
    // libsql uses .all() for SELECT and .run() for mutations;
    // we normalise both into the postgres-js .execute() contract.
    db.execute = async (sqlQuery: any) => {
      const raw =
        typeof sqlQuery?.source === "string"
          ? sqlQuery.source
          : typeof sqlQuery?.toQuery === "function"
            ? sqliteDialect.sqlToQuery(sqlQuery).sql
            : String(sqlQuery);
      const upper = raw.trim().slice(0, 12).toUpperCase();
      const isSelect = upper.startsWith("SELECT") || upper.startsWith("WITH");

      if (isSelect) {
        const rows = await db.all(sqlQuery);
        return { rows };
      }
      const result = await db.run(sqlQuery);
      return { rows: [], rowCount: result.changes };
    };

    return db;
  }

  // ── PostgreSQL (production) ──────────────────────────────────────
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL or LOCAL_DB_PATH is required");
  }
  const postgres = require("postgres");
  const { drizzle } = require("drizzle-orm/postgres-js");
  const pgClient = postgres(process.env.DATABASE_URL, { prepare: false });
  const allSchema = { ...schema, ...reviewsSchema, ...timeEventsSchema, ...compensationSurveySchema, ...datasetsSchema };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return drizzle(pgClient, { schema: allSchema }) as any;
}

type RuntimeDb = ReturnType<typeof getDb>;
let cachedDb: RuntimeDb | null = null;

function getRuntimeDb(): RuntimeDb {
  cachedDb ??= getDb();
  return cachedDb;
}

export const db = new Proxy(
  {},
  {
    get(_target, prop) {
      const runtimeDb = getRuntimeDb();
      const value = (runtimeDb as any)[prop];
      return typeof value === "function" ? value.bind(runtimeDb) : value;
    },
    set(_target, prop, value) {
      (getRuntimeDb() as any)[prop] = value;
      return true;
    },
  }
) as RuntimeDb;
export type Db = RuntimeDb;

export async function getFirst<T>(query: Promise<T[] | T>): Promise<T | undefined> {
  const result = await query;
  return Array.isArray(result) ? result[0] : result;
}
