import postgres from "postgres";
import { parseDatabaseTarget } from "./deployment-db-common";

import { accountantPermissions, canonicalRoles, employeePermissions, permissionCatalog } from "@/db/rbac-definitions";

export const CANONICAL_ROLES = canonicalRoles;
export const CANONICAL_PERMISSIONS = permissionCatalog;
export const CANONICAL_ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  owner: CANONICAL_PERMISSIONS.map((permission) => permission.code),
  accountant: accountantPermissions,
  employee: employeePermissions,
};

async function readRbac(sql: postgres.Sql) {
  const roles = await sql`select id,code,name,description from roles order by code`;
  const permissions = await sql`select id,code,module,label from permissions order by code`;
  const rolePermissions = await sql`select r.code as role,p.code as permission from role_permissions rp join roles r on r.id=rp.role_id join permissions p on p.id=rp.permission_id order by r.code,p.code`;
  return { roles, permissions, rolePermissions };
}

function expectedMappings() {
  return Object.entries(CANONICAL_ROLE_PERMISSIONS).flatMap(([role, codes]) => codes.map((permission) => `${role}:${permission}`));
}

async function bootstrapRbac(sql: postgres.Sql) {
  return sql.begin(async (tx) => {
    const roleIds = new Map<string, string>();
    for (const role of CANONICAL_ROLES) {
      await tx`insert into roles (code,name,description) values (${role.code},${role.name},${role.description}) on conflict (code) do nothing`;
      const [existing] = await tx`select id,name,description from roles where code=${role.code}`;
      if (!existing) throw new Error(`ABORT: ${role.code} role could not be resolved`);
      if (existing.name !== role.name || existing.description !== role.description) throw new Error(`REFUSED: conflicting definition for role ${role.code}`);
      roleIds.set(role.code, String(existing.id));
    }
    const permissionIds = new Map<string, string>();
    for (const permission of CANONICAL_PERMISSIONS) {
      await tx`insert into permissions (code,module,label) values (${permission.code},${permission.module},${permission.label}) on conflict (code) do nothing`;
      const [existing] = await tx`select id,module,label from permissions where code=${permission.code}`;
      if (!existing) throw new Error(`ABORT: ${permission.code} permission could not be resolved`);
      if (existing.module !== permission.module || existing.label !== permission.label) throw new Error(`REFUSED: conflicting definition for permission ${permission.code}`);
      permissionIds.set(permission.code, String(existing.id));
    }
    let mappingsInserted = 0;
    for (const [role, codes] of Object.entries(CANONICAL_ROLE_PERMISSIONS)) for (const code of codes) {
      const roleId = roleIds.get(role), permissionId = permissionIds.get(code);
      if (!roleId || !permissionId) throw new Error(`ABORT: unresolved RBAC mapping ${role}:${code}`);
      const result = await tx`insert into role_permissions (role_id,permission_id) values (${roleId},${permissionId}) on conflict (role_id,permission_id) do nothing returning role_id`;
      mappingsInserted += result.length;
    }
    return { roles: CANONICAL_ROLES.length, permissions: CANONICAL_PERMISSIONS.length, mappings: expectedMappings().length, mappingsInserted };
  });
}

async function verifyRbac(sql: postgres.Sql) {
  const report = await readRbac(sql);
  const roleMap = new Map(report.roles.map((role) => [String(role.code), role]));
  for (const role of CANONICAL_ROLES) console.log(`${role.code}: ${roleMap.has(role.code) && roleMap.get(role.code)?.name === role.name ? "PASS" : "FAIL"}`);
  const permissionMap = new Map(report.permissions.map((permission) => [String(permission.code), permission]));
  const permissionsPass = CANONICAL_PERMISSIONS.every((permission) => permissionMap.get(permission.code)?.module === permission.module && permissionMap.get(permission.code)?.label === permission.label);
  console.log(`permissions: ${permissionsPass ? "PASS" : "FAIL"} (${CANONICAL_PERMISSIONS.length} canonical permissions)`);
  const mappings = new Set(report.rolePermissions.map((row) => `${row.role}:${row.permission}`));
  for (const role of CANONICAL_ROLES) console.log(`${role.code} role_permissions: ${CANONICAL_ROLE_PERMISSIONS[role.code].every((code) => mappings.has(`${role.code}:${code}`)) ? "PASS" : "FAIL"}`);
  if (!permissionsPass || CANONICAL_ROLES.some((role) => !roleMap.has(role.code)) || expectedMappings().some((mapping) => !mappings.has(mapping))) throw new Error("RBAC verification failed");
}

async function main() {
  const argv = process.argv.slice(2), target = parseDatabaseTarget();
  console.log(`Target: ${target.classification} ${target.host}:${target.port}/${target.database} as ${target.user}`);
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const before = await readRbac(sql);
    console.log(`Before: roles=${before.roles.length} permissions=${before.permissions.length} role_permissions=${before.rolePermissions.length}`);
    if (argv.includes("--verify")) { await verifyRbac(sql); return; }
    if (!argv.includes("--execute")) { console.log("Mode: DRY RUN"); console.log(`Canonical: roles=${CANONICAL_ROLES.length} permissions=${CANONICAL_PERMISSIONS.length} role_permissions=${expectedMappings().length}`); return; }
    if (process.env.ALLOW_ALNOOR_RBAC_SEED !== "YES_I_UNDERSTAND") throw new Error("REFUSED: ALLOW_ALNOOR_RBAC_SEED guard is missing");
    if (target.classification === "REMOTE" && process.env.ALLOW_ALNOOR_REMOTE_SEED !== "YES_I_UNDERSTAND_THIS_IS_REMOTE") throw new Error("REFUSED: remote RBAC seed guard is missing");
    console.log("Mode: EXECUTE");
    const result = await bootstrapRbac(sql); console.log(`RBAC bootstrap complete: roles=${result.roles} permissions=${result.permissions} mappings=${result.mappings} newlyInsertedMappings=${result.mappingsInserted}`);
  } finally { await sql.end({ timeout: 2 }); }
}

if (import.meta.url === `file://${process.argv[1]}`) void main().catch((error) => { console.error(error instanceof Error ? error.message : "RBAC bootstrap failed"); process.exitCode = 1; });
export { bootstrapRbac, readRbac, verifyRbac };
