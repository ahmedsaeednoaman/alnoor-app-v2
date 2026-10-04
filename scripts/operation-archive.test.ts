import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import { buildSync } from "esbuild";
import { accountantPermissions, employeePermissions, permissionCatalog } from "../src/db/rbac-definitions";

// Synthetic state/transport only. No environment files, DB connections or data writes.
const operationId = randomUUID(), actor = randomUUID();
let authenticated = true, permissions = permissionCatalog.map(p => p.code), role = "owner";
let row: { archived_at: string | null; archived_by_user_id: string | null; archive_reason: string | null; status: string; created_at: string } | null = { archived_at: null, archived_by_user_id: null, archive_reason: null, status: "recorded", created_at: "2001-01-01" };
let events: Array<{ action: string; reason: unknown; actor: unknown }> = [];
let failEvent = false, posted = false;
const untouchedRelations = Object.freeze({ reviews: 1, items: 2, payments: 1, postings: 1, invoices: 1, procedures: 2, equipment: 1, catalogs: 10 });
const statements: string[] = [];
let queue = Promise.resolve();
const database = {
  async unsafe(sql: string, values: unknown[] = []) {
    statements.push(sql);
    if (sql.startsWith("SELECT archived_at")) { assert.match(sql, /FOR UPDATE/); return row ? [{ archived_at: row.archived_at }] : []; }
    if (sql.startsWith("UPDATE operations SET archived_at=now()")) {
      row!.archived_at = "2026-09-27T12:00:00Z"; row!.archived_by_user_id = String(values[1]); row!.archive_reason = values[2] as string | null; return [];
    }
    if (sql.startsWith("UPDATE operations SET archived_at=NULL")) { row!.archived_at = null; row!.archived_by_user_id = null; row!.archive_reason = null; return []; }
    if (sql.startsWith("INSERT INTO operation_archive_events")) {
      if (failEvent) throw new Error("synthetic rollback");
      events.push({ action: String(values[2]), reason: values[3], actor: values[1] }); return [];
    }
    if (sql.startsWith("UPDATE operations SET status='cancelled'")) {
      assert.match(sql, /NOT EXISTS\(SELECT 1 FROM doctor_account_postings WHERE operation_id=\$1::uuid AND reversed=false\)/);
      assert.match(sql, /cancellation_reason=\$2,cancelled_by_user_id=\$3::uuid,cancelled_at=now\(\)/);
      assert.doesNotMatch(sql, /48|current_date|created_at/);
      if (posted || !row || row.archived_at || row.status === "cancelled") return [];
      row.status = "cancelled"; return [{ id: operationId }];
    }
    throw new Error("Unexpected SQL in archive/cancel test");
  },
  begin<T>(run: (tx: { unsafe: (sql: string, values?: unknown[]) => Promise<unknown[]> }) => Promise<T>): Promise<T> {
    const task = queue.then(async () => {
      const previous = structuredClone({ row, events });
      try { return await run(database); } catch (error) { row = previous.row; events = previous.events; throw error; }
    });
    queue = task.then(() => {}, () => {}); return task;
  },
};
const nativeRequire = createRequire(import.meta.url);
function bundle(path: string) {
  const code = buildSync({ entryPoints: [path], bundle: true, write: false, platform: "node", format: "cjs", external: ["./session", "@/lib/auth/session", "@/db/client", "next/server"] }).outputFiles[0].text;
  const compiledModule = { exports: {} as { POST: (request: Request, context: { params: Promise<{ operationId: string }> }) => Promise<Response> } };
  vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, console: { error() {} }, Request, Response,
    require(name: string) {
      if (name === "@/lib/auth/session" || name === "./session") return { getCurrentSession: async () => authenticated ? { user: { id: actor, permissions, role: { code: role } } } : null };
      if (name === "@/db/client") return { postgresClient: database };
      return nativeRequire(name);
    },
  }); return compiledModule.exports;
}
const archive = bundle("src/app/api/v1/operations/[operationId]/archive/route.ts");
const restore = bundle("src/app/api/v1/operations/[operationId]/restore/route.ts");
const cancel = bundle("src/app/api/v1/operations/[operationId]/cancel/route.ts");
const post = (route: typeof archive, body: unknown = {}) => route.POST(new Request("http://localhost/test", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ operationId }) });
async function main() {
  for (const [code, grants] of [["employee", employeePermissions], ["accountant", accountantPermissions]] as const) {
    role = code; permissions = [...grants]; assert.equal((await post(archive)).status, 403); assert.equal((await post(restore)).status, 403);
  }
  authenticated = false; assert.equal((await post(archive)).status, 401); authenticated = true;
  role = "owner"; permissions = permissionCatalog.map(p => p.code);
  assert.equal((await post(archive, { status: "cancelled" })).status, 400);
  assert.equal((await post(archive, { reason: "x".repeat(2001) })).status, 400);
  const first = await post(archive, { reason: "synthetic archive reason" }); assert.equal(first.status, 200);
  assert.equal(row!.status, "recorded"); assert.ok(row!.archived_at); assert.equal(row!.archived_by_user_id, actor); assert.equal(events.length, 1);
  assert.equal((await post(archive, { reason: "must not overwrite first reason" })).status, 200); assert.equal(events.length, 1);
  assert.equal((await post(restore)).status, 200); assert.equal(row!.archived_at, null); assert.equal(row!.archive_reason, null); assert.equal(row!.archived_by_user_id, null);
  assert.equal(row!.status, "recorded"); assert.equal(events[0].reason, "synthetic archive reason"); assert.equal(events[1].action, "restore");
  await post(restore); assert.equal(events.length, 2);
  await Promise.all([post(archive), post(archive)]); assert.equal(events.length, 3, "serialized concurrent idempotency");
  await post(restore);
  failEvent = true; assert.equal((await post(archive)).status, 500); assert.equal(row!.archived_at, null, "event failure rolls back metadata"); failEvent = false;
  assert.equal((await post(cancel, { reason: "x" })).status, 400);
  posted = true; assert.equal((await post(cancel, { reason: "synthetic cancellation" })).status, 409); assert.equal(row!.status, "recorded"); posted = false;
  assert.equal((await post(cancel, { reason: "synthetic cancellation" })).status, 200); assert.equal(row!.status, "cancelled");
  await post(archive); await post(restore); assert.equal(row!.status, "cancelled", "restore never changes business status");
  assert.equal(untouchedRelations.reviews, 1); assert.equal(untouchedRelations.catalogs, 10);
  assert.ok(statements.every(sql => /^(SELECT archived_at|UPDATE operations SET (archived_at|status)|INSERT INTO operation_archive_events)/.test(sql)));
  assert.ok(statements.filter(sql => sql.startsWith("UPDATE operations SET archived_at")).every(sql => !/status=|DELETE|financial|doctor_account/.test(sql)));
  row = null; assert.equal((await post(archive)).status, 404);
  const migration = readFileSync("drizzle/0036_operation_archive.sql", "utf8");
  assert.doesNotMatch(migration, /ON DELETE cascade|DELETE FROM|DROP /i);
  assert.match(migration, /r.code='owner' AND p.code='operations.archive'/);
  assert.equal(employeePermissions.some(p => String(p) === "operations.archive"), false);
  assert.equal(accountantPermissions.some(p => String(p) === "operations.archive"), false);
  assert.equal(accountantPermissions.some(p => p === "operations.cancel"), true);
  console.log("Archive/cancel routes PASS: auth/RBAC, old Owner operation, strict payloads, metadata+event transaction/rollback, concurrent idempotency, restore status/history, no financial/reference writes, reason rules and posting blocker (mock DB only)");
}
void main();
