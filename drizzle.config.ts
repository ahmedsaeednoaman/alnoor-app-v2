import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

// تحميل المتغيرات البيئية من .env و .env.local
loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not configured");
}

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",

  dbCredentials: {
    url: databaseUrl,
  },

  strict: true,
  verbose: true,
});