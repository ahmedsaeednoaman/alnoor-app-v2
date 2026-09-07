import postgres from "postgres";
import * as argon2 from "argon2";
import { DEPLOYMENT_USERS, hashDeploymentPassword, parseDatabaseTarget, passwordValuesFromEnv } from "./deployment-db-common";

function assertDeploymentPasswordPolicy() {
  for (const value of passwordValuesFromEnv()) {
    if (!value.password) throw new Error(`Missing required environment variable: ${value.env}`);
    if (value.password.length < 12) throw new Error(`${value.env} must be at least 12 characters`);
    if (value.password.length > 128) throw new Error(`${value.env} must not exceed 128 characters`);
  }
}

async function seedUsers(sql: postgres.Sql) {
  assertDeploymentPasswordPolicy();
  return sql.begin(async (tx) => {
    const roles = new Map<string, string>();
    for (const code of ["owner", "accountant", "employee"]) {
      const rows = await tx`select id from roles where code = ${code}`;
      if (!rows[0]) throw new Error(`ABORT: ${code} role is missing`);
      roles.set(code, rows[0].id as string);
    }
    let created = 0;
    let updated = 0;
    for (const value of passwordValuesFromEnv()) {
      if (!value.password) throw new Error(`${value.env} is required`);
      const roleId = roles.get(value.role);
      if (!roleId) throw new Error(`ABORT: ${value.role} role is missing`);
      const existing = await tx`select id, display_name, base_role_id from users where username = ${value.username} limit 1`;
      const passwordHash = await hashDeploymentPassword(value.password);
      if (existing[0]) {
        if (existing[0].display_name !== value.displayName || existing[0].base_role_id !== roleId) throw new Error(`REFUSED: ${value.username} exists with a mismatched display name or role`);
        await tx`update users set password_hash = ${passwordHash}, status = 'active', archived_at = null, updated_at = now() where id = ${existing[0].id}`;
        updated += 1;
      } else {
        await tx`insert into users (username, password_hash, display_name, status, base_role_id) values (${value.username}, ${passwordHash}, ${value.displayName}, 'active', ${roleId})`;
        created += 1;
      }
    }
    return { created, updated, alreadySeeded: created === 0 && updated === 0 };
  });
}

async function verifyUsers(sql: postgres.Sql) {
  assertDeploymentPasswordPolicy();
  const values = passwordValuesFromEnv();
  const rows = await sql`select u.username, u.password_hash, u.status, u.archived_at, r.code as role_code from users u join roles r on r.id = u.base_role_id where u.username = any(${DEPLOYMENT_USERS.map((user) => user.username)})`;
  for (const value of values) {
    const row = rows.find((candidate) => candidate.username === value.username);
    const expected = DEPLOYMENT_USERS.find((user) => user.username === value.username)!;
    const valid = Boolean(row && row.status === "active" && !row.archived_at && row.role_code === expected.role && await argon2.verify(String(row.password_hash), value.password));
    console.log(`${value.username}: ${valid ? "PASS" : "FAIL"}`);
    if (!valid) throw new Error(`Credential verification failed for ${value.username}`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const target = parseDatabaseTarget();
  console.log(`Target: ${target.classification} ${target.host}:${target.port}/${target.database} as ${target.user}`);
  if (!argv.includes("--execute") && !argv.includes("--verify")) { console.log("Mode: DRY RUN"); console.log("Password supplied status:"); for (const user of passwordValuesFromEnv()) console.log(`${user.env}: ${user.password ? "YES" : "NO"}`); return; }
  if (argv.includes("--verify")) {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    try { await verifyUsers(sql); } finally { await sql.end({ timeout: 2 }); }
    return;
  }
  if (process.env.ALLOW_ALNOOR_USER_SEED !== "YES_I_UNDERSTAND") throw new Error("REFUSED: ALLOW_ALNOOR_USER_SEED guard is missing");
  if (target.classification === "REMOTE" && process.env.ALLOW_ALNOOR_REMOTE_SEED !== "YES_I_UNDERSTAND_THIS_IS_REMOTE") throw new Error("REFUSED: remote seed guard is missing");
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try { console.log("Mode: EXECUTE"); const result = await seedUsers(sql); console.log(`Created ${result.created} deployment users; updated ${result.updated} existing deployment users.`); } finally { await sql.end({ timeout: 2 }); }
}

if (import.meta.url === `file://${process.argv[1]}`) void main().catch((error) => { console.error(error instanceof Error ? error.message : "Seed failed"); process.exitCode = 1; });

export { seedUsers };
