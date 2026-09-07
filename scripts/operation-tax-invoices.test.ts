import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { taxInvoiceInputSchema, canCreateTaxInvoice, invoicePredicate, invoiceOrder } from "../src/lib/operations/tax-invoice";
import { operationFilterSchema, resolveOperationPagination } from "../src/lib/operations/validation";
import { updateOperationsQuery } from "../src/lib/operations/list-query";

const source = (path: string) => readFileSync(path, "utf8");
const input = { taxRegistry: "alnoor", invoiceNumber: " 00252 " };
assert.equal(taxInvoiceInputSchema.parse(input).invoiceNumber, "00252");
for (const invoiceNumber of ["", "  ", "2.5", "-1", "1e3", "12a", 252, "1".repeat(101)]) assert.equal(taxInvoiceInputSchema.safeParse({ ...input, invoiceNumber }).success, false);
assert.equal(taxInvoiceInputSchema.safeParse({ ...input, taxRegistry: "unknown" }).success, false);
for (const field of ["createdBy", "userId", "createdByUserId", "operationType", "caseName", "amount"]) assert.equal(taxInvoiceInputSchema.safeParse({ ...input, [field]: "forged" }).success, false);
assert.equal(canCreateTaxInvoice({ permissions: ["operations.view"] }), false);
assert.equal(canCreateTaxInvoice({ permissions: ["accounting.finance.edit"] }), false);
assert.equal(canCreateTaxInvoice({ permissions: ["operations.view", "accounting.finance.edit"] }), true);
assert.equal(invoicePredicate("pending"), "o.type = 'contract' AND ti.id IS NULL");
assert.equal(invoicePredicate("completed"), "ti.id IS NOT NULL");
assert.equal(invoiceOrder("latest"), "ti.created_at DESC, o.id DESC");

// Exercise real service methods with a recording database boundary; no production writes.
async function main() {
  const { postgresClient } = await import("../src/db/client");
  const { listOperations } = await import("../src/lib/operations/service");
  const { createTaxInvoice } = await import("../src/lib/operations/tax-invoice-service");
  const actor = { id: "11111111-1111-4111-8111-111111111111", role: { code: "accountant" }, permissions: ["operations.view", "accounting.finance.edit"] };
  const calls: { sql: string; values: unknown[] }[] = [];
  const originalUnsafe = postgresClient.unsafe, originalBegin = postgresClient.begin;
  let existing: Record<string, unknown> | undefined;
  const unsafe = async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.startsWith("SELECT count")) return [{ total: "51" }];
    if (sql.startsWith("SELECT id FROM operations")) return [{ id: actor.id }];
    if (sql.startsWith("INSERT INTO operation_tax_invoices")) { existing ??= { id: "invoice", registry: values[1], invoiceNumber: values[2], createdAt: "2026-09-07" }; return []; }
    if (sql.startsWith("SELECT id,tax_registry")) return [existing];
    return [];
  };
  postgresClient.unsafe = unsafe as unknown as typeof originalUnsafe;
  postgresClient.begin = (async (callback: (tx: { unsafe: typeof unsafe }) => unknown) => callback({ unsafe })) as unknown as typeof originalBegin;
  try {
    for (const invoiceStatus of ["pending", "completed", "latest"] as const) {
      calls.length = 0;
      const filters = operationFilterSchema.parse({ invoiceStatus, period: "custom", from: "2026-09-01", to: "2026-09-07", page: 2, pageSize: 25, type: "contract", doctorId: actor.id, hospitalId: actor.id, search: "case" });
      const result = await listOperations(filters, { ...actor, role: { code: "employee" } });
      assert.equal(result.pagination.totalPages, 3); assert.equal(result.pagination.total, 51);
      const [count, rows] = calls;
      const shared = count.sql.slice(count.sql.indexOf("FROM operations"));
      assert.ok(rows.sql.includes(shared), "count and items share all predicates");
      assert.ok(shared.includes(invoicePredicate(invoiceStatus)));
      assert.match(shared, /created_by_user_id = [\s\S]*current_date - 6/);
      assert.match(shared, /o.doctor_id = [\s\S]*o.hospital_id = [\s\S]*o.case_name ILIKE/);
      assert.ok(count.values.includes("2026-09-01")); assert.ok(count.values.includes("2026-09-08"));
      assert.match(rows.sql, /LIMIT .* OFFSET/); assert.deepEqual(rows.values.slice(-3), [25, 25, actor.id]);
      assert.ok(rows.sql.includes(`ORDER BY ${invoiceOrder(invoiceStatus)}`));
    }
    calls.length = 0;
    await assert.rejects(createTaxInvoice(actor.id, input, { ...actor, permissions: ["operations.view"] }));
    assert.equal(calls.length, 0);
    const saved = await createTaxInvoice(actor.id, input, actor);
    assert.equal(saved.invoiceNumber, "00252");
    assert.equal(calls.find(call => call.sql.startsWith("INSERT"))?.values[3], actor.id);
    const duplicate = await createTaxInvoice(actor.id, { ...input, invoiceNumber: "999" }, actor);
    assert.deepEqual(duplicate, saved);
    assert.ok(calls.some(call => call.sql.includes("ON CONFLICT(operation_id) DO NOTHING")));
    assert.ok(calls.some(call => call.sql.includes("FOR UPDATE")));
  } finally { postgresClient.unsafe = originalUnsafe; postgresClient.begin = originalBegin; await postgresClient.end(); }

  // Evaluate the exact supported SQL predicates against all six operation/invoice cases.
  for (const type of ["contract", "lithotripsy", "endoscopy"]) for (const hasInvoice of [false, true]) {
    const evaluate = (sql: string) => sql.replace("o.type = 'contract'", String(type === "contract")).replace("ti.id IS NULL", String(!hasInvoice)).replace("ti.id IS NOT NULL", String(hasInvoice)).replace(" AND ", " && ");
    assert.equal(Function(`return ${evaluate(invoicePredicate("pending"))}`)(), type === "contract" && !hasInvoice);
    assert.equal(Function(`return ${evaluate(invoicePredicate("completed"))}`)(), hasInvoice);
  }
  const current = "period=month&year=2026&month=9&page=3&pageSize=50&doctorId=" + actor.id;
  for (const key of ["invoiceStatus", "search", "doctorId", "hospitalId", "type", "from"]) {
    const next = new URLSearchParams(updateOperationsQuery(current, { [key]: "pending" }));
    assert.equal(next.get("page"), "1"); assert.equal(next.get("pageSize"), "50"); assert.equal(next.get("period"), "month");
  }
  assert.equal(new URLSearchParams(updateOperationsQuery(current, { page: "4" })).get("page"), "4");
  assert.equal(resolveOperationPagination(operationFilterSchema.parse({ invoiceStatus: "latest", period: "year", year: 2026, page: 3, pageSize: 100 })).offset, 200);
  const migration = source("drizzle/0034_operation_tax_invoices.sql");
  assert.match(migration, /CREATE UNIQUE INDEX.*operation_id/); assert.match(migration, /ON DELETE restrict/); assert.match(migration, /DEFAULT now\(\) NOT NULL/);
  const ui = source("src/components/operations/operations-list.tsx");
  assert.doesNotMatch(ui, /["\']مسجلة["\']/); assert.match(ui, /aria-controls="operations-filter-panel"/);
  assert.match(source("src/components/operations/operation-tax-invoice-modal.tsx"), /locked.current = true/);
  console.log("Tax invoice tests: PASS (mock database boundary; live PostgreSQL not verified)");
}
void main();
