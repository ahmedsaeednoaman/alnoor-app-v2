import assert from "node:assert/strict";
import { buildExpensePagination, buildExpensePredicate, groupExpenseRows, type ExpenseActor, type ExpenseRow } from "@/lib/expenses/service";

const owner: ExpenseActor = { id: "00000000-0000-4000-8000-000000000001", displayName: "أحمد", permissions: [], role: { code: "owner" } };
const accountant: ExpenseActor = { id: "00000000-0000-4000-8000-000000000002", displayName: "نور", permissions: ["expenses.view"], role: { code: "accountant" } };
const employee: ExpenseActor = { id: "00000000-0000-4000-8000-000000000003", displayName: "عبلة", permissions: ["expenses.create"], role: { code: "employee" } };

const range = { from: "2026-09-01", to: "2026-09-30" };
const page = buildExpensePagination(1, 7, 1);
const row = (id: string, userId: string): ExpenseRow => ({
  id, created_by_user_id: userId, employee_name_snapshot: userId === accountant.id ? "نور" : "عبلة",
  expense_date: "2026-09-07", expense_time: "11:20", amount: "50.00", category_id: "00000000-0000-4000-8000-000000000010",
  category_name_snapshot: "أخرى", description: "مواصلات", notes: null, created_at: new Date("2026-09-07T09:20:00Z"),
  reimbursement_status: "unpaid", paid_at: null, paid_by_user_id: null, day_total: "50.00", employee_subtotal: "50.00",
});

assert.equal(buildExpensePredicate({ status: "all", page: 1, pageSize: 7 }, owner, range).scope, "company");
for (const actor of [accountant, employee]) {
  const predicate = buildExpensePredicate({ status: "all", page: 1, pageSize: 7 }, actor, range);
  assert.equal(predicate.scope, "own");
  assert.ok(predicate.values.includes(actor.id), "self-only query must bind the authenticated actor");
}
const dto = groupExpenseRows([row("00000000-0000-4000-8000-000000000020", employee.id)], range, "company", "50.00", page);
assert.equal(dto.days[0]?.employees[0]?.entries[0]?.amount, "50.00");
assert.equal(dto.days[0]?.employees[0]?.entries[0]?.createdAt, "2026-09-07T09:20:00.000Z");
assert.equal(dto.pagination.totalPages, 1);
assert.deepEqual(groupExpenseRows([], range, "own", "0.00", buildExpensePagination(1, 7, 0)).days, []);
console.log("Expenses-05 list DTO, date serialization, owner scope, and self-only regression checks passed");
