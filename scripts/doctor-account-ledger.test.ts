import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildDoctorAccountLedger,
  calculateSavedOperationReferenceAmount,
  validateDoctorAccountPeriod,
} from "../src/lib/doctor-accounts";

type MovementType = "operation_posting" | "supply_issue" | "payment" | "adjustment";

function movement(
  id: string,
  type: MovementType,
  signedAmount: number,
  businessDate: string,
  occurredAt: string,
) {
  return {
    id,
    type,
    occurredAt,
    businessDate,
    description: id,
    amount: Math.abs(signedAmount),
    signedAmount,
    debitAmount: signedAmount > 0 ? signedAmount : 0,
    creditAmount: signedAmount < 0 ? Math.abs(signedAmount) : 0,
    effect: signedAmount >= 0 ? "debit" as const : "credit" as const,
    operationId: type === "operation_posting" ? id : null,
    caseName: type === "operation_posting" ? "حالة اختبار" : null,
    operationType: type === "operation_posting" ? "lithotripsy" : null,
    doctorNameSnapshot: type === "operation_posting" ? "طبيب اختبار" : null,
    operationReferenceAmount: type === "operation_posting" ? 5_000 : null,
    operationPostedAmount: type === "operation_posting" ? signedAmount : null,
    operationDifferenceAmount: type === "operation_posting" ? signedAmount - 5_000 : null,
    supplyItems: type === "supply_issue" ? [{
      id: `${id}-item`,
      sourceType: "manual" as const,
      sourceReferenceId: null,
      name: "مستلزم اختبار",
      quantity: 2,
      unitPrice: signedAmount / 2,
      totalAmount: signedAmount,
      notes: null,
    }] : [],
    notes: null,
  };
}

const period = buildDoctorAccountLedger([
  movement("a", "operation_posting", 3_000, "2026-09-01", "2026-08-31T21:00:00.000Z"),
  movement("b", "payment", -2_000, "2026-09-01", "2026-09-01T10:00:00.000Z"),
], 5_000, "2026-09-01", "2026-09-30");

assert.equal(period.openingBalance, 5_000);
assert.equal(period.periodDebit, 3_000);
assert.equal(period.periodCredit, 2_000);
assert.equal(period.periodNetMovement, 1_000);
assert.equal(period.closingBalance, 6_000);
assert.deepEqual(
  period.days[0].movements.map((item) => [item.balanceBefore, item.balanceAfter]),
  [[5_000, 8_000], [8_000, 6_000]],
);

const allTypes = buildDoctorAccountLedger([
  movement("op", "operation_posting", 5_000, "2026-09-01", "2026-09-01T08:00:00.000Z"),
  movement("supply", "supply_issue", 1_000, "2026-09-01", "2026-09-01T09:00:00.000Z"),
  movement("payment", "payment", -2_000, "2026-09-02", "2026-09-02T08:00:00.000Z"),
  movement("debit", "adjustment", 500, "2026-09-02", "2026-09-02T09:00:00.000Z"),
  movement("credit", "adjustment", -750, "2026-09-02", "2026-09-02T10:00:00.000Z"),
], 0, null, null);

assert.equal(allTypes.days.length, 2);
assert.equal(allTypes.days[0].openingBalance, 0);
assert.equal(allTypes.days[0].debitTotal, 6_000);
assert.equal(allTypes.days[0].closingBalance, 6_000);
assert.equal(allTypes.days[1].openingBalance, allTypes.days[0].closingBalance);
assert.equal(allTypes.days[1].debitTotal, 500);
assert.equal(allTypes.days[1].creditTotal, 2_750);
assert.equal(allTypes.days[1].closingBalance, 3_750);

const negative = buildDoctorAccountLedger([
  movement("credit-only", "adjustment", -250, "2026-09-03", "2026-09-03T08:00:00.000Z"),
], 0, "2026-09-03", "2026-09-03");
assert.equal(negative.closingBalance, -250);

const directReference = calculateSavedOperationReferenceAmount({
  accountingMode: "direct_items",
  mainAmount: 0,
  items: [
    { kind: "financial", financialEffect: "add", caseLineState: "included", baseAmount: 6_000, effectiveAmount: 2_000, amount: 2_000 },
    { kind: "financial", financialEffect: "subtract", caseLineState: "included", baseAmount: 4_000, effectiveAmount: 2_000, amount: 2_000 },
    { kind: "financial", financialEffect: "add", caseLineState: "excluded", baseAmount: 999, effectiveAmount: 999, amount: 999 },
  ],
});
assert.equal(directReference, 10_000);
assert.equal(4_000 - directReference, -6_000, "difference convention is posted minus reference");

assert.equal(calculateSavedOperationReferenceAmount({
  accountingMode: "main_amount",
  mainAmount: 7_500,
  items: [],
}), 7_500);

const cairoDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date("2026-08-31T22:30:00.000Z"));
assert.equal(cairoDate, "2026-09-01");

for (const invalidPeriod of [
  ["2026-02-30", "2026-03-01"],
  ["not-a-date", undefined],
  ["2026-10-01", "2026-09-30"],
] as const) {
  assert.throws(
    () => validateDoctorAccountPeriod(...invalidPeriod),
    (error: unknown) => {
      const domainError = error as { status?: number; code?: string; message?: string };
      return domainError.status === 400 &&
        domainError.code === "DOCTOR_ACCOUNT_PERIOD_INVALID" &&
        Boolean(domainError.message);
    },
  );
}

const source = readFileSync("src/lib/doctor-accounts.ts", "utf8");
assert.match(source, /coalesce\(p\.operation_type_snapshot, o\.type\) in \('lithotripsy', 'endoscopy'\)/, "Contract stays excluded from the canonical movement union");
assert.match(source, /at time zone 'Africa\/Cairo'/, "period boundaries explicitly use Cairo");
assert.match(source, /order by[\s\S]+occurred_at asc,\s+movement_type asc,\s+id asc/, "canonical ordering is deterministic");

console.log("Doctor Account canonical ledger regression checks passed");
