import postgres from "postgres";
import { DEPLOYMENT_USERS, RUNTIME_DELETE_TABLES, PRESERVED_MASTER_TABLES, assertExecuteGuards, assertPasswordPolicy, hashDeploymentPassword, parseDatabaseTarget, passwordValuesFromEnv, quoteIdentifier } from "./deployment-db-common";
import { inspectDatabase } from "./deployment-db-inspect";

async function createAhmed(tx: postgres.TransactionSql) {
  const value = passwordValuesFromEnv()[0];
  if (!value.password) throw new Error(`${value.env} is required`);
  const role = await tx`select id from roles where code = ${value.role}`;
  if (!role[0]) throw new Error("ABORT: owner role is missing");
  const passwordHash = await hashDeploymentPassword(value.password);
  const existing = await tx`select u.id, u.display_name, u.status, u.archived_at, r.code as role_code from users u join roles r on r.id = u.base_role_id where u.username = ${value.username}`;
  if (existing[0]) {
    if (existing[0].display_name !== value.displayName || existing[0].status !== "active" || existing[0].archived_at || existing[0].role_code !== "owner") {
      throw new Error("BLOCKER: existing ahmed does not match the intended fresh owner identity");
    }
    await tx`update users set password_hash = ${passwordHash}, archived_at = null, status = 'active' where id = ${existing[0].id}`;
    return existing[0].id as string;
  }
  const inserted = await tx`insert into users (username, password_hash, display_name, status, base_role_id) values (${value.username}, ${passwordHash}, ${value.displayName}, 'active', ${role[0].id}) returning id`;
  return inserted[0].id as string;
}

function assertPostResetInvariants(before: Awaited<ReturnType<typeof inspectDatabase>>, after: Awaited<ReturnType<typeof inspectDatabase>>) {
  for (const table of ["operations", "operation_financial_reviews", "operation_financial_items", "doctor_account_postings", "operation_tax_invoices", "doctor_payments", "doctor_account_adjustments", "sessions", "push_subscriptions", "push_dispatch_claims", "user_permission_overrides", "company_expenses"]) {
    if (after.counts[table] !== 0) throw new Error(`INVARIANT FAILED: ${table} is not empty`);
  }
  const expectedUsers = new Map(DEPLOYMENT_USERS.map((user) => [user.username, user.role]));
  if (after.users.length !== expectedUsers.size) throw new Error("INVARIANT FAILED: user count");
  for (const user of after.users) if (expectedUsers.get(String(user.username) as (typeof DEPLOYMENT_USERS)[number]["username"]) !== user.role_code || user.status !== "active" || user.archived_at) throw new Error("INVARIANT FAILED: deployment user identity");
  for (const table of PRESERVED_MASTER_TABLES) if (after.counts[table] !== before.counts[table]) throw new Error(`INVARIANT FAILED: preserved count changed for ${table}`);
  if (after.lithotripsy.total !== before.lithotripsy.total) throw new Error("INVARIANT FAILED: lithotripsy_sessions count changed");
  if (JSON.stringify(after.pricingSessionReferences) !== JSON.stringify(before.pricingSessionReferences)) throw new Error("INVARIANT FAILED: pricing session references changed");
}

async function executeReset(sql: postgres.Sql, before: Awaited<ReturnType<typeof inspectDatabase>>) {
  return sql.begin(async (tx) => {
    const ahmedId = await createAhmed(tx);
    for (const table of PRESERVED_MASTER_TABLES) {
      const columns = await tx`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${table} and column_name in ('created_by_user_id','updated_by_user_id')`;
      for (const column of columns) await tx.unsafe(`update public.${quoteIdentifier(table)} set ${quoteIdentifier(String(column.column_name))} = $1 where ${quoteIdentifier(String(column.column_name))} is not null`, [ahmedId]);
    }
    for (const table of RUNTIME_DELETE_TABLES.filter((name) => name !== "users")) await tx.unsafe(`delete from public.${quoteIdentifier(table)}`);
    const users = await tx`select id from users where id <> ${ahmedId}`;
    if (users.length) {
      for (const user of users) await tx`delete from users where id = ${user.id}`;
    }
    for (const value of passwordValuesFromEnv().slice(1)) {
      if (!value.password) throw new Error(`${value.env} is required`);
      const role = await tx`select id from roles where code = ${value.role}`;
      if (!role[0]) throw new Error(`ABORT: ${value.role} role is missing`);
      await tx`insert into users (username, password_hash, display_name, status, base_role_id) values (${value.username}, ${await hashDeploymentPassword(value.password)}, ${value.displayName}, 'active', ${role[0].id})`;
    }
    const after = await inspectDatabase(tx as unknown as postgres.Sql);
    assertPostResetInvariants(before, after);
    return { created: DEPLOYMENT_USERS.length };
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const target = parseDatabaseTarget();
  console.log(`Target: ${target.classification} ${target.host}:${target.port}/${target.database} as ${target.user}`);
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const report = await inspectDatabase(sql);
    console.log("DRY-RUN INSPECTION");
    console.log(JSON.stringify(report, null, 2));
    console.log("Execution preflight:");
    console.log(`Operations to delete: ${report.counts.operations ?? "missing"}`);
    console.log(`Runtime child rows: ${JSON.stringify(Object.fromEntries(Object.entries(report.counts).filter(([name]) => name !== "operations" && RUNTIME_DELETE_TABLES.includes(name as (typeof RUNTIME_DELETE_TABLES)[number]))))}`);
    console.log(`Old users to remove: ${report.users.filter((user) => user.username !== "ahmed").length}`);
    console.log(`Preserved lithotripsy_sessions: ${report.counts.lithotripsy_sessions ?? "missing"}`);
    console.log(`Pricing session references: ${report.pricingSessionReferences.length}`);
    console.log(`Creator/updater references to reassign: ${report.creatorReferences.reduce((sum, item) => sum + item.rows, 0)}`);
    console.log(`Deployment usernames: ${DEPLOYMENT_USERS.map((user) => user.username).join(", ")}`);
    console.log("Password supplied status:");
    for (const value of passwordValuesFromEnv()) console.log(`${value.env}: ${value.password ? "YES" : "NO"}`);
    if (!argv.includes("--execute")) { console.log("No mutation requested; dry-run complete."); return; }
    assertExecuteGuards(target, argv, "YES_I_UNDERSTAND", "YES_I_UNDERSTAND_THIS_IS_REMOTE");
    assertPasswordPolicy();
    const existingAhmed = report.users.find((user) => user.username === "ahmed");
    if (existingAhmed && (existingAhmed.display_name !== "أحمد" || existingAhmed.role_code !== "owner" || existingAhmed.status !== "active" || existingAhmed.archived_at)) throw new Error("BLOCKER: existing ahmed requires owner review");
    console.log("Mutation would begin only after all guards and checks pass.");
    await executeReset(sql, report);
    console.log("Reset and six-user seed completed.");
  } finally { await sql.end({ timeout: 2 }); }
}

if (import.meta.url === `file://${process.argv[1]}`) void main().catch((error) => { console.error(error instanceof Error ? error.message : "Reset failed"); process.exitCode = 1; });

export { executeReset };
