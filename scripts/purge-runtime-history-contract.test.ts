import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRESERVED_MASTER_TABLES } from "./deployment-db-common";
import { PRESERVED_RUNTIME_TABLES, RUNTIME_PURGE_TABLES } from "./purge-runtime-history";

const source = readFileSync(join(process.cwd(), "scripts/purge-runtime-history.ts"), "utf8");
const protectedTables = [
  "users",
  "sessions",
  "user_permission_overrides",
  "push_subscriptions",
  "roles",
  "permissions",
  "role_permissions",
  "doctors",
  "hospitals",
  "lithotripsy_sessions",
];

if (!source.includes("--execute")) throw new Error("execute guard missing");
if (!source.includes("ALLOW_ALNOOR_RUNTIME_PURGE") || !source.includes("ALLOW_ALNOOR_REMOTE_PURGE")) throw new Error("purge guards missing");
if (source.includes("TRUNCATE") || source.includes("DROP TABLE") || source.includes("DROP SCHEMA")) throw new Error("broad destructive SQL found");
if (/delete\s+from[^;]*\b(users|roles|permissions|role_permissions|doctors|hospitals|lithotripsy_sessions)\b/i.test(source)) throw new Error("protected delete found");
for (const table of protectedTables) if (RUNTIME_PURGE_TABLES.includes(table as never)) throw new Error(`protected table scheduled: ${table}`);
for (const table of ["operations", "operation_financial_reviews", "operation_financial_items", "doctor_account_postings", "doctor_payments", "doctor_account_adjustments", "company_expenses"]) if (!RUNTIME_PURGE_TABLES.includes(table as never)) throw new Error(`runtime table missing: ${table}`);
for (const table of ["users", "sessions", "user_permission_overrides", "push_subscriptions"]) if (!PRESERVED_RUNTIME_TABLES.includes(table as never)) throw new Error(`preserved runtime table missing: ${table}`);
if (!PRESERVED_MASTER_TABLES.includes("lithotripsy_sessions")) throw new Error("lithotripsy sessions not preserved");
if (!source.includes("pricingSessionReferences")) throw new Error("pricing reference invariant missing");
if (!source.includes("JSON.stringify(before.users)") || !source.includes("sql.begin")) throw new Error("identity/transaction protection missing");
if (!source.includes("assertPreservation")) throw new Error("rollback invariant missing");
console.log("runtime purge contract: PASS");
