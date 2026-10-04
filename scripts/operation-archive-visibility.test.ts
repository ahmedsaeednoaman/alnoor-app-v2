import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as validation from "../src/lib/operations/validation";
import { employeePermissions, accountantPermissions } from "../src/db/rbac-definitions";

const nativeRequire = createRequire(import.meta.url);
const calls: string[] = [];
let archived = false, cancelled = false, legacy = true;
const database = { unsafe: async (sql: string) => {
  calls.push(sql);
  if (/count\(\*\)::text/.test(sql)) return [{ total: "1" }];
  if (sql.includes('o.operation_date AS "operationDate"')) return [];
  if (sql.includes("SELECT o.*")) return [{ status: cancelled ? "cancelled" : "recorded", archived_at: archived ? "2026-09-27" : null, created_at: "2001-01-01", form_template_id: legacy ? null : "synthetic-template" }];
  if (sql.startsWith("SELECT id,name,version")) return [{ status: "published" }];
  return [];
} };
function load(file: string) {
  const exports: Record<string, (...args: any[]) => any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  vm.runInNewContext(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require(name: string) {
      if (name === "@/db/client") return { postgresClient: database };
      if (name.endsWith("/validation")) return validation;
      if (name === "./api") return nativeRequire("../src/lib/operations/api");
      if (name === "./tax-invoice") return nativeRequire("../src/lib/operations/tax-invoice");
      return {};
    },
  }); return exports;
}
async function main() {
  const service = load("src/lib/operations/service.ts"), details = load("src/lib/operations/details.ts");
  const owner = { id: "synthetic-actor", role: { code: "owner" }, permissions: ["operations.view", "operations.edit", "operations.cancel", "operations.archive"] };
  const filters = validation.operationFilterSchema.parse({ period: "month", year: 2001, month: 1 });
  for (const archive of [undefined, "active", "archived", "all"] as const) {
    calls.length = 0; await service.listOperations({ ...filters, archive }, owner);
    const sql = calls[0];
    if (!archive || archive === "active") assert.match(sql, /o.archived_at IS NULL/);
    else if (archive === "archived") { assert.match(sql, /o.archived_at IS NOT NULL/); assert.doesNotMatch(sql, /status <> 'cancelled'/); }
    else assert.doesNotMatch(sql, /archived_at IS|status <> 'cancelled'/);
    assert.doesNotMatch(sql, /current_date|created_by_user_id =/);
  }
  for (const [code, permissions] of [["employee", employeePermissions], ["accountant", accountantPermissions]] as const) {
    const user = { ...owner, role: { code }, permissions: [...permissions] };
    await assert.rejects(service.listOperations({ ...filters, archive: "archived" }, user), { status: 403 });
    await assert.rejects(service.listOperations({ ...filters, archive: "all" }, user), { status: 403 });
    calls.length = 0; await service.listOperations(filters, user);
    assert.match(calls[0], /o.archived_at IS NULL/);
    if (code === "employee") assert.match(calls[0], /current_date - 6/);
    else assert.doesNotMatch(calls[0], /current_date - 6/);
  }
  for (legacy of [true, false]) {
    calls.length = 0;
    const active = await details.getDynamicOperationDetails("synthetic-operation", owner, false, database);
    assert.equal(active.canCancel, true); assert.equal(active.canArchive, true); assert.equal(active.editExpiresAt, null);
    assert.equal(active.canEdit, !legacy, "historical legacy rows have no editable template, independently of age");
    assert.doesNotMatch(calls[0], /current_date-6/);
    archived = true;
    const stored = await details.getDynamicOperationDetails("synthetic-operation", owner, false, database);
    assert.equal(stored.canEdit, false); assert.equal(stored.canCancel, false); assert.equal(stored.canArchive, true);
    await assert.rejects(details.getDynamicOperationDetails("synthetic-operation", { ...owner, permissions: [...accountantPermissions] }, false, database), { status: 404 });
    archived = false; cancelled = true;
    const canceled = await details.getDynamicOperationDetails("synthetic-operation", owner, false, database);
    assert.equal(canceled.canEdit, false); assert.equal(canceled.canCancel, false); assert.equal(canceled.canArchive, true);
    cancelled = false;
  }
  const review = readFileSync("src/lib/accounting/review.ts", "utf8");
  assert.match(review, /const conditions = \["o.status='recorded'", "o.archived_at IS NULL"\]/);
  assert.match(review, /WHERE o.id=any\(\$1::uuid\[\]\) AND o.status='recorded' AND o.archived_at IS NULL/);
  const home = readFileSync("src/lib/home.ts", "utf8"); assert.equal((home.match(/o\.archived_at is null/g) ?? []).length, 4);
  // Historical accounting and printing remain available under their old rules.
  assert.doesNotMatch(readFileSync("src/lib/printing/projection.ts", "utf8"), /o\.archived_at/);
  const apply = load("src/components/operations/operations-list.tsx").applyOperationManagementResult;
  const rows = [{ id: "synthetic-one", status: "recorded", archivedAt: null }, { id: "synthetic-two", status: "recorded", archivedAt: null }];
  assert.equal(apply(rows, "synthetic-one", "archive", "active").length, 1);
  assert.equal(apply(rows, "synthetic-one", "restore", "archived").length, 1);
  const stored = apply(rows, "synthetic-one", "archive", "all");
  assert.equal(stored.length, 2); assert.equal(stored[0].status, "recorded"); assert.ok(stored[0].archivedAt);
  assert.equal(apply(stored, "synthetic-one", "restore", "all")[0].archivedAt, null);
  assert.equal(apply(rows, "synthetic-one", "cancel", "all")[0].status, "cancelled");
  assert.equal(rows[0].archivedAt, null, "state is immutable");
  const list = readFileSync("src/components/operations/operations-list.tsx", "utf8");
  assert.match(list, /OperationManagementActions/); assert.match(list, /requestVersion.current\+\+; \/\/ Reject a list GET/);
  assert.match(list, /setItems\(current=>applyOperationManagementResult/); assert.doesNotMatch(list, /location.reload/);
  console.log("Archive visibility/capabilities PASS: active/archived/all SQL, permission isolation, Owner age independence, legacy and template cancel capabilities, archived/cancelled edit gating, active dashboards/reviews vs historical printing (mock DB/source contracts)");
}
void main();
