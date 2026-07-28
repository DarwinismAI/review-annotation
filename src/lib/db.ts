/**
 * Re-export the shared Drizzle db instance.
 * Actual singleton lives in src/db/client.ts (WAL + foreign_keys enabled).
 */
export { db } from "@/db/client";
export type { Db } from "@/db/client";
