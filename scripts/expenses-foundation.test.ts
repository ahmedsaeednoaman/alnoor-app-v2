import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ExpenseDomainError,
  assertExpenseCreatePermission,
  assertExpenseSettlementAuthority,
  buildExpensePagination,
  buildExpensePredicate,
  cairoBusinessNow,
  groupExpenseRows,
  resolveExpenseReadScope,
  type ExpenseActor,
  type ExpenseRow,
} from "@/lib/expenses/service";
import { expenseCreateSchema, expenseFilterSchema } from "@/lib/expenses/validation";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const employeeA: ExpenseActor = { id: "00000000-0000-4000-8000-000000000001", displayName: "أحمد", permissions: ["expenses.create"], role: { code: "employee" } };
const employeeB: ExpenseActor = { id: "00000000-0000-4000-8000-000000000002", displayName: "محمد", permissions: ["expenses.create"], role: { code: "employee" } };
const accountant: ExpenseActor = { id: "00000000-0000-4000-8000-000000000003", displayName: "المحاسب", permissions: ["expenses.view", "expenses.review"], role: { code: "accountant" } };
const ownerA: ExpenseActor = { id: "00000000-0000-4000-8000-000000000004", displayName: "المالك الأول", permissions: [], role: { code: "owner" } };
const ownerB: ExpenseActor = { ...ownerA, id: "00000000-0000-4000-8000-000000000005", displayName: "المالك الثاني" };

assert.doesNotThrow(() => assertExpenseCreatePermission(employeeA));
assert.equal(resolveExpenseReadScope(employeeA), "own");
assert.equal(resolveExpenseReadScope(employeeB), "own");
assert.equal(resolveExpenseReadScope(accountant), "own", "expenses.view never grants company scope to Accountant");
assert.equal(resolveExpenseReadScope(ownerA), "company");
assert.equal(resolveExpenseReadScope(ownerB), "company", "multiple Owner accounts are supported");
assert.throws(() => assertExpenseSettlementAuthority(employeeA), (error: unknown) => error instanceof ExpenseDomainError && error.code === "EXPENSE_SETTLEMENT_FORBIDDEN");
assert.throws(() => assertExpenseSettlementAuthority(accountant), (error: unknown) => error instanceof ExpenseDomainError && error.code === "EXPENSE_SETTLEMENT_FORBIDDEN");
assert.doesNotThrow(() => assertExpenseSettlementAuthority(ownerA));
assert.doesNotThrow(() => assertExpenseSettlementAuthority(ownerB));

const validInput = { amount: "50", description: "استأجرت عربية من المكتب لمستشفى الزينة", notes: null, idempotencyKey: "expense-test-key-0001" };
assert.equal(expenseCreateSchema.safeParse(validInput).success, true);
for (const forged of ["employeeId", "userId", "createdByUserId", "employeeName", "expenseDate", "expenseTime", "categoryId", "paidByUserId", "paidAt"]) {
  assert.equal(expenseCreateSchema.safeParse({ ...validInput, [forged]: employeeB.id }).success, false, `${forged} must not enter create`);
}
for (const amount of [0, -1, "1.001", Number.POSITIVE_INFINITY, "1000000000.00"]) assert.equal(expenseCreateSchema.safeParse({ ...validInput, amount }).success, false);
assert.equal(expenseCreateSchema.parse({ ...validInput, amount: 12.3 }).amount, "12.30");
assert.deepEqual(cairoBusinessNow(new Date("2026-09-04T22:30:00.000Z")), { date: "2026-09-05", time: "01:30" });

const filters = expenseFilterSchema.parse({ month: "2026-09", status: "unpaid" });
for (const actor of [employeeA, employeeB, accountant]) {
  const built = buildExpensePredicate(filters, actor, { from: "2026-09-01", to: "2026-09-30" });
  assert.equal(built.scope, "own");
  assert.match(built.predicate, /created_by_user_id/);
  assert.ok(built.values.includes(actor.id));
}
for (const owner of [ownerA, ownerB]) {
  const built = buildExpensePredicate(filters, owner, { from: "2026-09-01", to: "2026-09-30" });
  assert.equal(built.scope, "company");
  assert.doesNotMatch(built.predicate, /created_by_user_id/);
}
const forgedEmployeeFilter = expenseFilterSchema.parse({ month: "2026-09", status: "all", employeeId: employeeB.id });
const safePredicate = buildExpensePredicate(forgedEmployeeFilter, employeeA, { from: "2026-09-01", to: "2026-09-30" });
assert.ok(safePredicate.values.includes(employeeA.id));
assert.ok(!safePredicate.values.includes(employeeB.id), "employee filter cannot escape own scope");
const employeeOutstanding = buildExpensePredicate(expenseFilterSchema.parse({ status: "unpaid" }), employeeA, { from: "2025-09-06", to: "2026-09-05" });
assert.ok(employeeOutstanding.values.includes("unpaid"), "paid expenses disappear from employee outstanding query");
const ownerPaid = buildExpensePredicate(expenseFilterSchema.parse({ month: "2026-09", status: "paid" }), ownerA, { from: "2026-09-01", to: "2026-09-30" });
const ownerAll = buildExpensePredicate(expenseFilterSchema.parse({ month: "2026-09", status: "all" }), ownerA, { from: "2026-09-01", to: "2026-09-30" });
assert.ok(ownerPaid.values.includes("paid"), "paid expenses remain queryable in Owner history");
assert.doesNotMatch(ownerAll.predicate, /reimbursement_status/, "Owner all-history retains paid records");

const row = (overrides: Partial<ExpenseRow> = {}): ExpenseRow => ({ id: "e1", created_by_user_id: employeeA.id, employee_name_snapshot: employeeA.displayName, expense_date: "2026-09-05", expense_time: "09:30", amount: "50.00", category_id: "00000000-0000-4000-8000-000000000010", category_name_snapshot: "أخرى", description: validInput.description, notes: null, created_at: "2026-09-05T06:30:00.000Z", reimbursement_status: "unpaid", paid_at: null, paid_by_user_id: null, day_total: "50.00", employee_subtotal: "50.00", ...overrides });
const grouped = groupExpenseRows([row()], { from: "2026-09-01", to: "2026-09-30" }, "own", "50.00", buildExpensePagination(1, 7, 1));
assert.equal(grouped.totalAmount, "50.00");
assert.equal(grouped.days[0].employees[0].entries[0].reimbursementStatus, "unpaid");
assert.deepEqual(buildExpensePagination(1, 7, 18), { unit: "day", page: 1, pageSize: 7, totalDays: 18, totalPages: 3, hasNext: true, hasPrevious: false });
assert.equal(expenseFilterSchema.parse({}).status, "unpaid");
assert.equal(expenseFilterSchema.parse({}).pageSize, 7);
for (const pageSize of ["7", "14", "30"]) assert.equal(expenseFilterSchema.safeParse({ pageSize }).success, true);
for (const pageSize of ["8", "31"]) assert.equal(expenseFilterSchema.safeParse({ pageSize }).success, false);

const service = source("src/lib/expenses/service.ts");
const route = source("src/app/api/v1/expenses/route.ts");
const paidRoute = source("src/app/api/v1/expenses/[expenseId]/mark-paid/route.ts");
const form = source("src/components/expenses/expense-form.tsx");
const styles = source("src/app/globals.css");
const migration = source("drizzle/0033_expense_reimbursements.sql");
assert.match(service, /role\.code === "owner"/);
assert.match(service, /normalized_name='أخرى'/);
assert.match(service, /cairoBusinessNow\(\)/);
assert.match(service, /reimbursement_status='paid',paid_at=now\(\),paid_by_user_id=\$2::uuid/);
assert.match(service, /where id=\$1::uuid and reimbursement_status='unpaid'/);
assert.match(service, /alreadyPaid: true/);
assert.match(service, /sum\(amount\)/, "totals remain PostgreSQL NUMERIC SUM");
assert.match(service, /matching_expenses[\s\S]*where \$\{predicate\}/);
assert.equal((service.match(/where \$\{predicate\}/g) ?? []).length, 2, "count and rows share privacy/status/month predicate");
assert.doesNotMatch(service, /expenses\.review/);
assert.doesNotMatch(route, /paidByUserId|paidAt|createdByUserId/);
assert.doesNotMatch(paidRoute, /request\.json/);
assert.match(migration, /DEFAULT 'unpaid' NOT NULL/);
assert.match(migration, /paid_at/);
assert.match(migration, /paid_by_user_id/);
assert.doesNotMatch(paidRoute, /export async function (PUT|PATCH|DELETE)/);
assert.doesNotMatch(form, /type="(date|time)"|<select|categoryId|employeeId/);
assert.match(form, /المبلغ/);
assert.match(form, /دفعت الفلوس في إيه؟/);
assert.match(styles, /@media\(max-width:600px\)/, "360/390/430 layouts use the compact Expense workflow");
console.log("Expense reimbursement security and workflow checks passed");
