import assert from "node:assert/strict";
import { calculateSimpleReviewTotals, effectiveAmount, parseSignedAdjustment } from "@/lib/accounting/simple-review";

assert.equal(parseSignedAdjustment("200"), 200);
assert.equal(parseSignedAdjustment("+200"), 200);
assert.equal(parseSignedAdjustment("-50"), -50);
assert.equal(parseSignedAdjustment(""), null);
assert.equal(effectiveAmount(450, 200), 650);
assert.equal(effectiveAmount(450, -50), 400);
assert.equal(effectiveAmount(450, -500), null);
const totals = calculateSimpleReviewTotals(5000, [
  { kind: "financial", amount: "450", baseAmount: "450", adjustmentAmount: "200", effectiveAmount: "650", financialEffect: "subtract" },
  { kind: "financial", amount: "450", baseAmount: "450", adjustmentAmount: "150", effectiveAmount: "600", financialEffect: "subtract" },
  { kind: "financial", amount: "200", financialEffect: "subtract", caseLineState: "excluded" },
  { kind: "note", amount: null, financialEffect: "neutral" },
]);
assert.deepEqual(totals, { additionTotal: 0, deductionTotal: 1250, totalCosts: 1250, finalBalance: 3750 });
assert.equal(calculateSimpleReviewTotals(5000, [{ kind: "financial", amount: 100, financialEffect: "add" }]).finalBalance, 5100);
console.log("Lithotripsy simple review checks passed (adjustments, exclusion, notes, live totals)");
