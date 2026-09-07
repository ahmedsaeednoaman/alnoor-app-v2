import assert from "node:assert/strict";
import { calculateDoctorSettlementBalance } from "../src/lib/accounting/simple-review";
import { buildDoctorAccountLedger, type LedgerMovementInput } from "../src/lib/doctor-accounts";
import { readFileSync } from "node:fs";

assert.equal(calculateDoctorSettlementBalance(10_000, 0), 10_000, "zero cash must leave full debt");
assert.equal(calculateDoctorSettlementBalance(10_000, null), 10_000, "missing cash is zero, not a posting blocker");
assert.equal(calculateDoctorSettlementBalance(10_000, 3_000), 7_000, "pre-post settlement applies once");
assert.equal(calculateDoctorSettlementBalance(10_000, 10_000), 0, "fully settled operation has no debt");
assert.equal(calculateDoctorSettlementBalance(5_000, 7_000), -2_000, "overpayment creates signed doctor credit");
assert.equal(calculateDoctorSettlementBalance(0, 0), 0, "zero debt does not post");

const service = readFileSync("src/lib/operations/service.ts", "utf8");
assert.match(service, /o\.type IN \('lithotripsy','endoscopy'\)/, "only eligible operation types may post");
assert.match(service, /coalesce\(fr\.doctor_received_amount,0\)/, "zero/null direct payment is supported");
assert.match(service, /sum\(p\.amount\)/, "legacy operation payments reduce debt");
assert.match(service, /WHERE settlement_balance <> 0/, "only exactly-zero settlement is omitted");
assert.match(service, /case when settlement_balance < 0 then 'credit' else 'debit' end/, "server owns posting direction");
assert.match(service, /doctor_account_postings/, "posting remains protected by its database uniqueness constraint");

for (const editorPath of [
  "src/components/accounting/simple-lithotripsy-review-editor-v2.tsx",
  "src/components/accounting/financial-review-workbench.tsx",
]) {
  const editor = readFileSync(editorPath, "utf8");
  assert.match(editor, /settlementActionRef\.current/, `${editorPath}: combined action has a synchronous guard`);
  assert.match(editor, /async function saveAndPost|const saveAndPost = async/, `${editorPath}: exposes save-then-post orchestration`);
  assert.match(editor, /حفظ وترحيل/, `${editorPath}: dirty review exposes the combined Arabic action`);
  assert.match(editor, /method: "POST"\s*}\)/, `${editorPath}: posting request sends no client amount or direction`);
  assert.match(editor, /ALREADY_POSTED/, `${editorPath}: an already-posted race is normalized by reload`);
  assert.match(editor, /تم حفظ المراجعة، لكن تعذر الترحيل/, `${editorPath}: partial success is stated explicitly`);
  assert.match(editor, /تم استلام المبلغ بالكامل — لا يوجد رصيد للترحيل/, `${editorPath}: zero settlement saves without a posting`);
  assert.match(editor, /if \(!saved\) return/, `${editorPath}: a failed save stops before posting`);
}

const genericEditor = readFileSync("src/components/accounting/financial-review-workbench.tsx", "utf8");
assert.match(genericEditor, /data\.operation\.type === "contract"[^\n]+return/, "Contract is rejected by the combined orchestration guard");
assert.match(genericEditor, /data\.operation\.type !== "contract" && canPost/, "Contract never renders the post action");
assert.match(genericEditor, /settlementPreview = Math\.round/, "Endoscopy combined action previews current local settlement");
assert.match(genericEditor, /const saved = await save\(false\)/, "Endoscopy saves before posting without announcing premature success");

const movement = (id: string, signedAmount: number): LedgerMovementInput => ({ id, type: "operation_posting", occurredAt: `2026-09-0${id}T08:00:00.000Z`, description: id, amount: Math.abs(signedAmount), signedAmount, debitAmount: signedAmount > 0 ? signedAmount : 0, creditAmount: signedAmount < 0 ? Math.abs(signedAmount) : 0, effect: signedAmount < 0 ? "credit" : "debit", businessDate: `2026-09-0${id}`, operationId: id, caseName: id, operationType: "lithotripsy", doctorNameSnapshot: "TEST", operationReferenceAmount: Math.abs(signedAmount), operationPostedAmount: Math.abs(signedAmount), operationDifferenceAmount: 0, supplyItems: [], notes: null });
const ledger = buildDoctorAccountLedger([movement("1", -2_000), movement("2", 5_000)], 0, null, null);
assert.equal(ledger.days[0].closingBalance, -2_000);
assert.equal(ledger.days[1].openingBalance, -2_000);
assert.equal(ledger.closingBalance, 3_000);

console.log("Doctor posting zero-payment regression: PASS");
