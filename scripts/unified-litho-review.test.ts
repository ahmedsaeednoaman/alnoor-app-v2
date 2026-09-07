import assert from "node:assert/strict";
import { calculateSimpleReviewTotals } from "@/lib/accounting/simple-review";
import { financialReviewSchema } from "@/lib/operations/validation";

const referenceLine = { kind: "financial" as const, amount: "450", baseAmount: "450", adjustmentAmount: "0", effectiveAmount: "450", financialEffect: "add" as const, caseLineState: "included" as const };
const extraLine = { kind: "financial" as const, amount: "200", baseAmount: null, adjustmentAmount: null, effectiveAmount: "200", financialEffect: "add" as const, caseLineState: "included" as const };

assert.equal(calculateSimpleReviewTotals(0, [referenceLine, extraLine]).finalBalance, 650, "450 + 200 must equal 650");
assert.equal(calculateSimpleReviewTotals(0, [{ ...referenceLine, amount: "500", adjustmentAmount: "50", effectiveAmount: "500" }, extraLine]).finalBalance, 700, "500 + 200 must equal 700");
assert.equal(calculateSimpleReviewTotals(0, [{ ...referenceLine, amount: "0", adjustmentAmount: "-450", effectiveAmount: "0" }, extraLine]).finalBalance, 200, "explicit zero must remain numeric zero");
assert.equal(calculateSimpleReviewTotals(0, [{ ...referenceLine, caseLineState: "excluded" }, extraLine]).finalBalance, 200, "excluded line must not affect totals");
assert.equal(calculateSimpleReviewTotals(0, [referenceLine, { ...extraLine, caseLineState: "excluded" }]).finalBalance, 450, "restoring the reference line keeps its amount");

const validZero = financialReviewSchema.safeParse({ expectedUpdatedAt: null, mainAmount: "0", notes: null, items: [{ kind: "financial", description: "صفر صريح", amount: "0", baseAmount: null, adjustmentAmount: null, effectiveAmount: "0", caseLineState: "included", financialEffect: "add", sourceType: "manual", sourceFieldId: null, sourceReferenceId: null, notes: null }] });
assert.equal(validZero.success, true, "explicit zero must pass review validation");
const missingCaseAmount = financialReviewSchema.safeParse({ expectedUpdatedAt: null, mainAmount: "0", notes: null, items: [{ kind: "financial", description: "سعر غير محدد", amount: null, baseAmount: null, adjustmentAmount: null, effectiveAmount: null, caseLineState: "included", financialEffect: "add", sourceType: "manual", sourceFieldId: null, sourceReferenceId: null, notes: null }] });
assert.equal(missingCaseAmount.success, false, "an included financial line requires an explicit case amount before save");

console.log("Unified Lithotripsy review checks passed (450+200, case override, exclusion, zero/null)");
