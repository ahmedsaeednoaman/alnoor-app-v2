import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildHomeData, type HomeReadDependencies } from "../src/lib/home";

const operation = {
  id: "operation-1",
  type: "endoscopy" as const,
  operationDate: "2026-09-04",
  operationTime: "10:00",
  caseName: "Owned case",
  doctorName: "Doctor",
  hospitalName: "Hospital",
  status: "recorded",
  employeeEditWindow: true,
};

const calls = { today: 0, operations: 0, review: 0, doctors: 0 };
const dependencies: HomeReadDependencies = {
  async countToday(user) { calls.today += 1; assert.equal(user.id, "employee-1"); return 137; },
  async recentOperations(user, limit) { calls.operations += 1; assert.equal(user.id, "employee-1"); assert.equal(limit, 5); return [operation]; },
  async awaitingReview() { calls.review += 1; return { count: 81, operations: [operation] }; },
  async doctorAccounts() { calls.doctors += 1; return [{ doctorId: "doctor-1", doctorName: "Doctor", specialty: null, balance: 5000, movementCount: 3, lastMovementAt: null }]; },
};

async function run() {
const employee = await buildHomeData({
  id: "employee-1",
  displayName: "Employee",
  role: { code: "employee", name: "Employee" },
  permissions: ["operations.view", "operations.edit"],
}, dependencies);

assert.equal(employee.today?.operationCount, 137, "today uses the exact count dependency, not recent list length");
assert.equal(employee.recentOperations?.length, 1);
assert.equal(employee.recentOperations?.[0].id, "operation-1", "employee receives only the ownership-scoped dependency projection");
assert.equal(employee.recentOperations?.[0].canEdit, true, "employee 48-hour eligibility is retained");
assert.equal(employee.review, null, "accounting.review gates all review data");
assert.equal(employee.doctorAccounts, null, "doctor_accounts.view gates all account data");
assert.equal(calls.review, 0, "unauthorized review query is not executed");
assert.equal(calls.doctors, 0, "unauthorized Doctor Account query is not executed");
assert.equal("mainAmount" in employee.recentOperations![0], false, "operation projection contains no finance");
assert.equal("financial" in employee, false, "Home DTO has no generic finance section");
assert.equal("expenses" in employee, false, "Home DTO contains no fake expense data");

const privilegedDependencies: HomeReadDependencies = {
  ...dependencies,
  async countToday() { return 137; },
  async recentOperations() { return [operation]; },
};
const privileged = await buildHomeData({
  id: "owner-1",
  displayName: "Owner",
  role: { code: "owner", name: "Owner" },
  permissions: ["operations.view", "operations.edit", "accounting.review", "accounting.finance.view", "doctor_accounts.view", "reports.view", "printing.use", "settings.view"],
}, privilegedDependencies);

assert.equal(privileged.review?.awaitingCount, 81);
assert.deepEqual(Object.keys(privileged.review!.awaitingOperations[0]).sort(), ["caseName", "date", "doctorName", "hospitalName", "id", "time", "type"].sort());
assert.deepEqual(Object.keys(privileged.doctorAccounts!.accounts[0]).sort(), ["balance", "doctorId", "doctorName", "lastMovementAt"].sort());
assert.equal("overdue" in privileged.doctorAccounts!.accounts[0], false);
assert.equal("needsAttention" in privileged.doctorAccounts!.accounts[0], false);
assert.equal(privileged.capabilities.canViewReports, true);
assert.equal(privileged.capabilities.canUsePrinting, true);

const source = readFileSync("src/lib/home.ts", "utf8");
assert.match(source, /import "server-only"/, "contract is server-only");
assert.match(source, /select count\(\*\)::text count[\s\S]+o\.operation_date = current_date/, "today is an exact database COUNT");
assert.match(source, /created_by_user_id=\$2::uuid[\s\S]+operation_date >= current_date-6/, "employee recent visibility is own operations over seven calendar dates");
assert.match(source, /created_at >= now\(\)-interval '48 hours'/, "employee edit window remains 48 hours");
assert.match(source, /o\.status='recorded'[\s\S]+coalesce\(fr\.status,'awaiting_review'\)='awaiting_review'/, "review count uses the Financial Review recorded-operation predicate");

console.log("Home data contract regression: PASS");
}

void run();
