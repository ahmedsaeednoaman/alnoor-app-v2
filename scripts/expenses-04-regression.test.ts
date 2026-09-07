import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertExpenseSettlementAuthority,
  buildExpensePredicate,
  canCreatePersonalExpense,
  ExpenseDomainError,
  type ExpenseActor,
} from "@/lib/expenses/service";

const employeeA: ExpenseActor = { id: "00000000-0000-4000-8000-000000000001", displayName: "عبلة", permissions: ["expenses.create"], role: { code: "employee" } };
const employeeB: ExpenseActor = { id: "00000000-0000-4000-8000-000000000002", displayName: "وداد", permissions: ["expenses.create"], role: { code: "employee" } };
const accountant: ExpenseActor = { id: "00000000-0000-4000-8000-000000000003", displayName: "نور", permissions: ["expenses.view", "expenses.review"], role: { code: "accountant" } };
const owner: ExpenseActor = { id: "00000000-0000-4000-8000-000000000004", displayName: "أحمد", permissions: [], role: { code: "owner" } };

for (const actor of [employeeA, employeeB, accountant, owner]) assert.equal(canCreatePersonalExpense(actor), true);
for (const actor of [employeeA, employeeB, accountant]) {
  const result = buildExpensePredicate({ status: "all", page: 1, pageSize: 7 }, actor, { from: "2026-09-01", to: "2026-09-30" });
  assert.equal(result.scope, "own");
  assert.ok(result.values.includes(actor.id));
}
assert.equal(buildExpensePredicate({ status: "all", page: 1, pageSize: 7 }, owner, { from: "2026-09-01", to: "2026-09-30" }).scope, "company");
assert.throws(() => assertExpenseSettlementAuthority(accountant), (error: unknown) => error instanceof ExpenseDomainError && error.code === "EXPENSE_SETTLEMENT_FORBIDDEN");
assert.throws(() => assertExpenseSettlementAuthority(employeeA), (error: unknown) => error instanceof ExpenseDomainError && error.code === "EXPENSE_SETTLEMENT_FORBIDDEN");
assert.doesNotThrow(() => assertExpenseSettlementAuthority(owner));

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
assert.match(source("src/app/(shell)/company/expenses/page.tsx"), /canCreatePersonalExpense/);
assert.match(source("src/components/expenses/expenses-list.tsx"), /\{canCreate && <ExpenseForm/);
assert.match(source("src/components/shell/mobile-bottom-navigation.tsx"), /permissions\.includes\("expenses\.view"\)/);
assert.match(source("src/db/seed.ts"), /"expenses\.create"/);
console.log("Expenses-04 privacy, creation, settlement, and mobile access checks passed");
