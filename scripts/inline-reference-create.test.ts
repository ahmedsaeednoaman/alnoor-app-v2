import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { buildSync } from "esbuild";
import { accountantPermissions, employeePermissions, permissionCatalog } from "../src/db/rbac-definitions";
import { resolveInlineReferenceSource } from "../src/lib/work-forms/inline-reference-sources";

// Execute real route/guard/validation/catalog-service code. Only session lookup
// and database transport are replaced. No database connection or writes occur.
const nativeRequire = createRequire(import.meta.url);
let permissions: string[] = [];
let authenticated = true;
const inserts: Array<{ table: string; data: Record<string, unknown> }> = [];
const unique = new Set<string>();
const database = {
  async unsafe(sql: string, values: unknown[]) {
    const match = /INSERT INTO "([a-z_]+)" \(([^)]+)\)/.exec(sql);
    assert.ok(match, `Unexpected database access: ${sql}`);
    const columns = match[2].split(", ").map(column => column.replaceAll('"', ""));
    const data = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
    const key = `${match[1]}:${data.normalized_name}`;
    // Simulates the existing atomic unique index, including competing inserts.
    if (unique.has(key)) throw { code: "23505" };
    unique.add(key); inserts.push({ table: match[1], data });
    return [{ ...data, id: "00000000-0000-4000-8000-000000000001", is_active: true,
      phone: "must-not-return", default_amount: 100, created_by_user_id: "private-actor" }];
  },
};
type Route = { POST?: (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
  PATCH?: (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response> };
function route(path: string): Route {
  const code = buildSync({ entryPoints: [path], bundle: true, write: false, platform: "node", format: "cjs",
    external: ["./session", "@/lib/auth/session", "@/db/client", "next/server"],
  }).outputFiles[0].text;
  const compiledModule = { exports: {} };
  vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, console, Request, Response,
    require(name: string) {
      if (name === "@/lib/auth/session" || name === "./session") return { getCurrentSession: async () => authenticated ? {
        user: { id: "actor", permissions, role: { code: "not-used-for-authority" } },
      } : null };
      if (name === "@/db/client") return { postgresClient: database };
      return nativeRequire(name);
    },
  });
  return compiledModule.exports;
}
const reference = route("src/app/api/v1/work-forms/references/[source]/route.ts");
const catalog = route("src/app/api/v1/catalogs/[type]/route.ts");
const edit = route("src/app/api/v1/catalogs/[type]/[id]/route.ts");
const archive = route("src/app/api/v1/catalogs/[type]/[id]/archive/route.ts");
const restore = route("src/app/api/v1/catalogs/[type]/[id]/restore/route.ts");
function post(source: string, body: unknown) {
  return reference.POST!(new Request(`http://test/api/v1/work-forms/references/${source}`, {
    method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
  }), { params: Promise.resolve({ source }) });
}
async function main() {
  for (const [label, grants] of [
    ["Owner", permissionCatalog.map(item => item.code)], ["Employee", employeePermissions], ["Accountant", accountantPermissions],
  ] as const) {
    permissions = [...grants];
    const response = await post("doctors", { name: `  ${label}   Doctor  ` });
    assert.equal(response.status, 201, label);
    assert.deepEqual(await response.json(), { id: "00000000-0000-4000-8000-000000000001", name: `${label} Doctor` });
    assert.equal(inserts.at(-1)!.data.created_by_user_id, "actor");
    if (label !== "Owner") {
      assert.equal(permissions.includes("catalogs.manage"), false);
      const context = { params: Promise.resolve({ type: "doctors", id: "00000000-0000-4000-8000-000000000001" }) };
      for (const [handler, method] of [[catalog.POST, "POST"], [edit.PATCH, "PATCH"], [archive.POST, "POST"], [restore.POST, "POST"]] as const) {
        const result = await handler!(new Request("http://test", { method, body: JSON.stringify({ name: "Denied" }) }), context);
        assert.equal(result.status, 403, `${label} cannot use catalog ${method}`);
      }
    }
  }
  permissions = ["catalogs.manage"];
  assert.equal((await post("doctors", { name: "Not a creator" })).status, 403);
  permissions = ["operations.create"];
  authenticated = false;
  assert.equal((await post("doctors", { name: "Not authenticated" })).status, 401);
  authenticated = true;
  for (const source of ["users", "financial-items", "financial_items", "side", "boolean", "sessions", "arbitrary", "__proto__", "constructor"]) {
    assert.equal(resolveInlineReferenceSource(source), null);
    assert.equal((await post(source, { name: "Denied source" })).status, 400);
  }
  const supported = ["doctors", "hospitals", "procedures", "equipment", "consumables", "stents", "anesthesia_types", "anesthesiologists", "technicians", "contract_entities", "anesthesia-types", "contract-entities"];
  for (const [index, source] of supported.entries()) {
    assert.equal((await post(source, { name: `Source ${index}` })).status, 201, source);
    const record = inserts.at(-1)!;
    assert.equal(record.table, resolveInlineReferenceSource(source)!.catalog.replaceAll("-", "_"));
    assert.equal(record.data.is_active, undefined);
    assert.equal(record.data.linked_user_id, undefined);
    if (source === "procedures") assert.equal(record.data.category, "عام");
    if (source === "equipment") assert.equal(record.data.equipment_type, "عام");
    if (source.startsWith("contract")) assert.equal(record.data.entity_type, "other");
  }
  for (const field of ["isActive", "defaultAmount", "linkedUserId", "fixedHospitalId", "contractEntityId", "permissions", "role", "archivedAt", "category", "entityType", "phone"]) {
    assert.equal((await post("doctors", { name: "Injection", [field]: "forbidden" })).status, 400, field);
  }
  for (const body of [{}, { name: " " }, { name: " ا " }, { name: 123 }, { name: "a".repeat(201) }, null, []]) {
    assert.equal((await post("doctors", body)).status, 400);
  }
  assert.equal((await reference.POST!(new Request("http://test", { method: "POST", body: "{" }), { params: Promise.resolve({ source: "doctors" }) })).status, 400);
  assert.equal((await post("doctors", { name: " محمد   أحمد " })).status, 201);
  const duplicate = await post("doctors", { name: "محمد أحمد" });
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error.code, "CATALOG_NAME_ALREADY_EXISTS");
  const before = inserts.length;
  const competing = await Promise.all([post("hospitals", { name: "Concurrent Name" }), post("hospitals", { name: " concurrent  NAME " })]);
  assert.deepEqual(competing.map(result => result.status).sort(), [201, 409]);
  assert.equal(inserts.length, before + 1);
  // Confirm the real schema declares the uniqueness relied upon above. This is
  // source evidence, not a claim that a live DB concurrency test was performed.
  const schema = readFileSync("src/db/schema/catalogs.ts", "utf8");
  for (const source of supported.slice(0, 10)) {
    const table = resolveInlineReferenceSource(source)!.catalog.replaceAll("-", "_");
    assert.ok(schema.includes(`uniqueIndex("${table}_current_name_unique")`), table);
  }
  console.log("Inline reference API PASS: real guards/routes/service; roles, deny paths, 10 sources/aliases, strict payload/defaults, minimal DTO, normalized/concurrent conflicts (mock DB transport; no DB writes)");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
