import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

const databaseUrl =
  process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not configured",
  );
}

declare global {
  var __alnoorPostgres:
    | ReturnType<typeof postgres>
    | undefined;
}

export const postgresClient =
  globalThis.__alnoorPostgres ??
  postgres(databaseUrl, {
    max: 10,
  });

if (
  process.env.NODE_ENV !== "production"
) {
  globalThis.__alnoorPostgres =
    postgresClient;
}

export const db = drizzle(
  postgresClient,
  {
    schema,
  },
);
