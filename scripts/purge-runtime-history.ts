import postgres from "postgres";
import {
  PRESERVED_MASTER_TABLES,
  parseDatabaseTarget,
  quoteIdentifier,
} from "./deployment-db-common";
import { inspectDatabase } from "./deployment-db-inspect";

const RUNTIME_PURGE_TABLES = [
  "operation_financial_payments",
  "doctor_account_postings",
  "operation_financial_items",
  "operation_tax_invoices",
  "operation_financial_reviews",
  "operation_consumables",
  "operation_equipment",
  "operation_field_reference_values",
  "operation_field_values",
  "operation_participants",
  "operation_procedures",
  "operation_stents",
  "push_dispatch_claims",
  "operations",
  "doctor_payments",
  "doctor_account_adjustments",
  "doctor_supply_issue_items",
  "doctor_supply_issues",
  "company_expenses",
] as const;

const PRESERVED_RUNTIME_TABLES = [
  "users",
  "sessions",
  "user_permission_overrides",
  "push_subscriptions",
] as const;

const ZERO_AFTER_PURGE = RUNTIME_PURGE_TABLES;

type Inspection = Awaited<ReturnType<typeof inspectDatabase>>;

function assertPreservation(before: Inspection, after: Inspection) {
  for (const table of ZERO_AFTER_PURGE) {
    if (after.counts[table] !== 0) throw new Error(`INVARIANT FAILED: ${table} is not empty`);
  }
  for (const table of [...PRESERVED_MASTER_TABLES, ...PRESERVED_RUNTIME_TABLES]) {
    if (after.counts[table] !== before.counts[table]) throw new Error(`INVARIANT FAILED: preserved count changed for ${table}`);
  }
  if (JSON.stringify(after.users) !== JSON.stringify(before.users)) throw new Error("INVARIANT FAILED: user identities or roles changed");
  if (JSON.stringify(after.pricingSessionReferences) !== JSON.stringify(before.pricingSessionReferences)) throw new Error("INVARIANT FAILED: pricing/session references changed");
}

async function purgeInsideTransaction(tx: postgres.TransactionSql, before: Inspection) {
  for (const table of RUNTIME_PURGE_TABLES) {
    await tx.unsafe(`delete from public.${quoteIdentifier(table)}`);
  }
  const after = await inspectDatabase(tx as unknown as postgres.Sql);
  assertPreservation(before, after);
}

async function main() {
  const argv = process.argv.slice(2);
  const target = parseDatabaseTarget();
  console.log("Database target:");
  console.log(`Host: ${target.host}`);
  console.log(`Port: ${target.port}`);
  console.log(`Database: ${target.database}`);
  console.log(`User: ${target.user}`);
  console.log(`Target classification: ${target.classification}`);

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const before = await inspectDatabase(sql);
    console.log("Runtime purge preflight:");
    for (const table of RUNTIME_PURGE_TABLES) console.log(`${table}: ${before.counts[table] ?? "missing"}`);
    console.log("Preserved users/sessions/subscriptions:");
    for (const table of PRESERVED_RUNTIME_TABLES) console.log(`${table}: ${before.counts[table] ?? "missing"}`);
    console.log("Preserved master/configuration counts:");
    for (const table of PRESERVED_MASTER_TABLES) console.log(`${table}: ${before.counts[table] ?? "missing"}`);
    console.log(`Pricing/session references: ${before.pricingSessionReferences.length}`);

    if (!argv.includes("--execute")) {
      console.log("No mutation requested; dry-run complete.");
      return;
    }

    if (!argv.includes("--execute")) throw new Error("REFUSED: --execute is required");
    if (process.env.EXPECTED_DATABASE_NAME && process.env.EXPECTED_DATABASE_NAME !== target.database) {
      throw new Error("REFUSED: EXPECTED_DATABASE_NAME does not match the target");
    }
    if (process.env.ALLOW_ALNOOR_RUNTIME_PURGE !== "YES_I_UNDERSTAND") {
      throw new Error("REFUSED: ALLOW_ALNOOR_RUNTIME_PURGE guard is missing");
    }
    if (target.classification === "REMOTE" && process.env.ALLOW_ALNOOR_REMOTE_PURGE !== "YES_I_UNDERSTAND_THIS_IS_REMOTE") {
      throw new Error("REFUSED: remote purge guard is missing");
    }

    await sql.begin((tx) => purgeInsideTransaction(tx, before));
    console.log("Runtime history purge completed.");
  } finally {
    await sql.end({ timeout: 2 });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Runtime purge failed");
    process.exitCode = 1;
  });
}

export { RUNTIME_PURGE_TABLES, PRESERVED_RUNTIME_TABLES, assertPreservation, purgeInsideTransaction };
