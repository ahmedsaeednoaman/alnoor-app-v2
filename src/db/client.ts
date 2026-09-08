import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

declare global {
  var __alnoorPostgres:
    | ReturnType<typeof postgres>
    | undefined;
}

type PostgresClient = ReturnType<typeof postgres>;

let initializedClient: PostgresClient | undefined;

/**
 * Resolve the database connection only when a query is actually invoked.
 * Next statically evaluates route modules during build/page collection, so
 * importing this module must not require runtime-only DATABASE_URL config.
 */
export function getPostgresClient(): PostgresClient {
  if (initializedClient) return initializedClient;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }

  initializedClient = globalThis.__alnoorPostgres ?? postgres(databaseUrl, {
    max: 10,
  });

  // Match drizzle-orm/postgres-js' normal parser configuration. The Drizzle
  // constructor cannot configure the real client until this lazy point.
  const transparentParser = (value: unknown) => value;
  const parserOptions = initializedClient.options as unknown as {
    parsers: Record<string, (value: unknown) => unknown>;
    serializers: Record<string, (value: unknown) => unknown>;
  };
  for (const type of ["1184", "1082", "1083", "1114", "1182", "1185", "1115", "1231"]) {
    parserOptions.parsers[type] = transparentParser;
    parserOptions.serializers[type] = transparentParser;
  }
  parserOptions.serializers["114"] = transparentParser;
  parserOptions.serializers["3802"] = transparentParser;

  if (process.env.NODE_ENV !== "production") {
    globalThis.__alnoorPostgres = initializedClient;
  }

  return initializedClient;
}

/**
 * Keep the existing postgres-js/Drizzle exports and call sites intact while
 * deferring connection creation. Method wrappers bind calls to the real
 * client after runtime configuration has been loaded.
 */
export const postgresClient = new Proxy((() => undefined) as unknown as PostgresClient, {
  apply(_target, thisArg, args) {
    return Reflect.apply(getPostgresClient() as unknown as (...values: unknown[]) => unknown, thisArg, args);
  },
  get(_target, property) {
    if (property === "then") return undefined;
    // Drizzle configures postgres-js type parsers while constructing the
    // database object. Keep that build-time inspection side-effect-free; the
    // real client uses postgres-js defaults and is created on first query.
    if (property === "options") return { parsers: {}, serializers: {} };
    return (...args: unknown[]) => {
      const client = getPostgresClient() as unknown as Record<PropertyKey, unknown>;
      const member = client[property];
      if (typeof member !== "function") return member;
      return (member as (...values: unknown[]) => unknown).apply(client, args);
    };
  },
}) as PostgresClient;

export const db = drizzle(postgresClient, { schema });
