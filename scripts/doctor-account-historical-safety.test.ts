import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildDoctorAccountLedger,
  type LedgerMovementInput,
} from "../src/lib/doctor-accounts";

const source = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const posting = source("src/lib/operations/service.ts");
const ledger = source("src/lib/doctor-accounts.ts");
const review = source("src/lib/accounting/review.ts");
const details = source("src/lib/operations/details.ts");
const migration = source(
  "drizzle/0030_doctor_account_historical_safety.sql",
);

for (const column of [
  "case_name_snapshot",
  "operation_type_snapshot",
  "doctor_name_snapshot",
  "reference_amount_snapshot",
  "difference_amount_snapshot",
]) {
  assert.match(posting, new RegExp(column));
  assert.match(ledger, new RegExp(column));
  assert.match(migration, new RegExp(column));
}

assert.match(posting, /o\.type IN \('lithotripsy','endoscopy'\)/);
assert.doesNotMatch(posting, /INSERT INTO doctor_account_postings[^;]*\$3/i);
assert.match(posting, /settlement_balance-reference_amount/);
assert.match(posting, /coalesce\(i\.base_amount,i\.effective_amount,i\.amount,0\)/);
assert.match(ledger, /coalesce\(p\.case_name_snapshot, o\.case_name\)/);
assert.match(ledger, /coalesce\(p\.operation_type_snapshot, o\.type\)/);
assert.match(review, /POSTED_FINANCIAL_REVIEW_IMMUTABLE/);
assert.match(details, /POSTED_OPERATION_DOCTOR_IMMUTABLE/);
assert.match(posting, /OPERATION_PAYMENT_AFTER_POSTING_FORBIDDEN/);

const snapshotMovement: LedgerMovementInput = {
  id: "00000000-0000-4000-8000-000000000001",
  type: "operation_posting",
  occurredAt: "2026-08-01T10:00:00.000Z",
  businessDate: "2026-08-01",
  description: "ترحيل حالة: الاسم التاريخي",
  amount: 4000,
  signedAmount: 4000,
  debitAmount: 4000,
  creditAmount: 0,
  effect: "debit",
  operationId: "00000000-0000-4000-8000-000000000002",
  caseName: "الاسم التاريخي",
  operationType: "lithotripsy",
  doctorNameSnapshot: "الطبيب التاريخي",
  operationReferenceAmount: 10000,
  operationPostedAmount: 4000,
  operationDifferenceAmount: -6000,
  supplyItems: [],
  notes: null,
};

const projected = buildDoctorAccountLedger(
  [snapshotMovement],
  0,
  null,
  null,
);
assert.equal(projected.closingBalance, 4000);
const historical = projected.days[0].movements[0];
assert.equal(historical.operationReferenceAmount, 10000);
assert.equal(historical.operationPostedAmount, 4000);
assert.equal(historical.operationDifferenceAmount, -6000);
assert.equal(historical.caseName, "الاسم التاريخي");
assert.equal(historical.doctorNameSnapshot, "الطبيب التاريخي");

console.log("Doctor account historical safety regression: PASS");
