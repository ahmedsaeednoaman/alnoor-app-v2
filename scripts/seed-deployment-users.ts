import postgres from "postgres";
import { DEPLOYMENT_USERS, assertPasswordPolicy, hashDeploymentPassword, parseDatabaseTarget, passwordValuesFromEnv } from "./deployment-db-common";

async function seedUsers(sql: postgres.Sql) {
  assertPasswordPolicy();
  return sql.begin(async (tx) => {
    const roles = new Map<string, string>();
    for (const code of ["owner", "accountant", "employee"]) {
      const rows = await tx`select id from roles where code = ${code}`;
      if (!rows[0]) throw new Error(`ABORT: ${code} role is missing`);
      roles.set(code, rows[0].id as string);
    }
    let matching = 0;
    for (const value of DEPLOYMENT_USERS) {
      const existing = await tx`select display_name, base_role_id from users where username = ${value.username}`;
      if (!existing.length) continue;
      if (existing[0].display_name !== value.displayName || existing[0].base_role_id !== roles.get(value.role)) throw new Error("REFUSED: partial or mismatched deployment user state");
      matching += 1;
    }
    if (matching === DEPLOYMENT_USERS.length) return { created: 0, alreadySeeded: true };
    if (matching > 0) throw new Error("REFUSED: partial deployment user state");
    for (const value of passwordValuesFromEnv()) {
      if (!value.password) throw new Error(`${value.env} is required`);
      const roleId = roles.get(value.role);
      if (!roleId) throw new Error(`ABORT: ${value.role} role is missing`);
      await tx`insert into users (username, password_hash, display_name, status, base_role_id) values (${value.username}, ${await hashDeploymentPassword(value.password)}, ${value.displayName}, 'active', ${roleId})`;
    }
    return { created: DEPLOYMENT_USERS.length };
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const target = parseDatabaseTarget();
  console.log(`Target: ${target.classification} ${target.host}:${target.port}/${target.database} as ${target.user}`);
  if (!argv.includes("--execute")) { console.log("Dry-run only. Password supplied status:"); for (const user of passwordValuesFromEnv()) console.log(`${user.env}: ${user.password ? "YES" : "NO"}`); return; }
  if (process.env.ALLOW_ALNOOR_USER_SEED !== "YES_I_UNDERSTAND") throw new Error("REFUSED: ALLOW_ALNOOR_USER_SEED guard is missing");
  if (target.classification === "REMOTE" && process.env.ALLOW_ALNOOR_REMOTE_SEED !== "YES_I_UNDERSTAND_THIS_IS_REMOTE") throw new Error("REFUSED: remote seed guard is missing");
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try { const result = await seedUsers(sql); console.log(result.alreadySeeded ? "Deployment users are already seeded." : `Created ${result.created} deployment users.`); } finally { await sql.end({ timeout: 2 }); }
}

if (import.meta.url === `file://${process.argv[1]}`) void main().catch((error) => { console.error(error instanceof Error ? error.message : "Seed failed"); process.exitCode = 1; });

export { seedUsers };
