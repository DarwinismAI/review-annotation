import type { Config } from "drizzle-kit";

const localPath = process.env.LOCAL_DB_PATH;

const config: Config = localPath
  ? {
      schema: [
        "./src/db/schema.sqlite.ts",
        "./src/db/reviews.sqlite.ts",
        "./src/db/time-events.sqlite.ts",
        "./src/db/compensation-survey.sqlite.ts",
        "./src/db/datasets.sqlite.ts",
      ],
      out: "./migrations-sqlite",
      dialect: "turso",
      dbCredentials: { url: localPath },
    }
  : {
      schema: [
        "./src/db/schema.ts",
        "./src/db/reviews.ts",
        "./src/db/time-events.ts",
        "./src/db/compensation-survey.ts",
        "./src/db/datasets.ts",
      ],
      out: "./migrations",
      dialect: "postgresql",
      dbCredentials: { url: process.env.DATABASE_URL! },
    };

export default config;
