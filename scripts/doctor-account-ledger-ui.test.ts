import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildDoctorAccountLedger,
  type LedgerMovementInput,
} from "../src/lib/doctor-accounts";

const movement = (
  id: string,
  type: LedgerMovementInput["type"],
  signedAmount: number,
  businessDate: string,
  balanceContext: Partial<LedgerMovementInput> = {},
): LedgerMovementInput => ({
  id,
  type,
  occurredAt: `${businessDate}T10:00:00+02:00`,
  businessDate,
  description: "حركة اختبار",
  amount: Math.abs(signedAmount),
  signedAmount,
  debitAmount: signedAmount > 0 ? signedAmount : 0,
  creditAmount: signedAmount < 0 ? Math.abs(signedAmount) : 0,
  effect: signedAmount >= 0 ? "debit" : "credit",
  operationId: null,
  caseName: null,
  operationType: null,
  doctorNameSnapshot: null,
  operationReferenceAmount: null,
  operationPostedAmount: null,
  operationDifferenceAmount: null,
  supplyItems: [],
  notes: null,
  ...balanceContext,
});

const ledger = buildDoctorAccountLedger(
  [
    movement("operation", "operation_posting", 3000, "2026-09-01", {
      operationId: "00000000-0000-4000-8000-000000000001",
      caseName: "TEST حالة دفتر",
      operationType: "lithotripsy",
      doctorNameSnapshot: "TEST طبيب تاريخي",
      operationReferenceAmount: 10000,
      operationPostedAmount: 3000,
      operationDifferenceAmount: -7000,
    }),
    movement("supply", "supply_issue", 1000, "2026-09-01"),
    movement("payment", "payment", -2500, "2026-09-02"),
    movement("credit", "adjustment", -500, "2026-09-02"),
  ],
  5000,
  "2026-09-01",
  "2026-09-30",
);

assert.equal(ledger.openingBalance, 5000);
assert.equal(ledger.periodDebit, 4000);
assert.equal(ledger.periodCredit, 3000);
assert.equal(ledger.periodNetMovement, 1000);
assert.equal(ledger.closingBalance, 6000);
assert.equal(ledger.days[0].closingBalance, 9000);
assert.equal(ledger.days[1].openingBalance, 9000);
assert.equal(ledger.days[1].closingBalance, 6000);
assert.equal(ledger.days[0].movements[0].balanceBefore, 5000);
assert.equal(ledger.days[0].movements[0].balanceAfter, 8000);

const quiet = buildDoctorAccountLedger([], 7000, "2026-10-01", "2026-10-31");
assert.equal(quiet.days.length, 0);
assert.equal(quiet.openingBalance, 7000);
assert.equal(quiet.closingBalance, 7000);

const negative = buildDoctorAccountLedger(
  [movement("negative", "adjustment", -1500, "2026-11-01")],
  1000,
  "2026-11-01",
  "2026-11-30",
);
assert.equal(negative.closingBalance, -500);

const component = readFileSync(
  "src/components/accounting/doctor-account-details.tsx",
  "utf8",
);
for (const field of [
  "data.openingBalance",
  "data.periodDebit",
  "data.periodCredit",
  "data.periodNetMovement",
  "data.closingBalance",
  "data.ledger.days",
  "movement.balanceBefore",
  "movement.balanceAfter",
  "day.openingBalance",
  "day.closingBalance",
]) {
  assert.ok(component.includes(field), `UI must consume backend field ${field}`);
}
assert.doesNotMatch(component, /data\.movements\.reduce/);
assert.doesNotMatch(component, /day\.movements\.reduce/);
assert.match(component, /timeZone: "Africa\/Cairo"/);
assert.match(component, /رصيد لصالح الطبيب/);
assert.match(component, /لا توجد حركات خلال هذه الفترة/);
assert.match(component, /operationReferenceAmount/);
assert.match(component, /operationPostedAmount/);
assert.match(component, /operationDifferenceAmount/);
assert.match(component, /href={`\/operations#\$\{movement\.operationId\}`}/);
assert.match(component, /canManage={canManageCatalogs}/);
assert.match(component, /إضافة المستلزمات للحساب/);

const operationsList = readFileSync(
  "src/components/operations/operations-list.tsx",
  "utf8",
);
assert.match(operationsList, /window\.location\.hash\.slice\(1\)/);
assert.match(operationsList, /setDetailId\(id\)/);

const smartSelect = readFileSync(
  "src/components/operations/smart-select.tsx",
  "utf8",
);
assert.match(smartSelect, /\+ إضافة &quot;\{normalizedSearch\}&quot;/);
assert.match(smartSelect, /fetch\(`\/api\/v1\/catalogs\/\$\{type\}`/);
assert.match(smartSelect, /onChange\(multiple \? [\s\S]*body\.item\.id/);

console.log("Doctor Account paper-ledger UI contract: PASS");
