import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CANONICAL_PERMISSIONS, CANONICAL_ROLE_PERMISSIONS, CANONICAL_ROLES } from "./seed-deployment-rbac";

const source = readFileSync("scripts/seed-deployment-rbac.ts", "utf8");
assert.deepEqual(CANONICAL_ROLES.map((role) => role.code), ["owner", "accountant", "employee"]);
assert.ok(CANONICAL_PERMISSIONS.length >= 20);
assert.equal(CANONICAL_ROLE_PERMISSIONS.owner.length, CANONICAL_PERMISSIONS.length);
assert.ok(CANONICAL_ROLE_PERMISSIONS.accountant.includes("expenses.create"));
assert.ok(CANONICAL_ROLE_PERMISSIONS.employee.includes("expenses.create"));
assert.match(source, /on conflict \(code\) do nothing/);
assert.match(source, /on conflict \(role_id,permission_id\) do nothing/);
assert.match(source, /ALLOW_ALNOOR_RBAC_SEED/);
assert.match(source, /ALLOW_ALNOOR_REMOTE_SEED/);
assert.match(source, /Mode: DRY RUN/);
assert.match(source, /Mode: EXECUTE/);
assert.doesNotMatch(source, /truncate|drop table|delete from/i);
assert.doesNotMatch(source, /operations|company_expenses|doctors|pricing_profiles/i);
console.log("DEPLOYMENT-RBAC-01 contract: PASS");
