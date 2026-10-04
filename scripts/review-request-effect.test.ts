import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startReviewEffect } from "../src/lib/accounting/review-request-effect";
async function main() {
  const signals: AbortSignal[] = [];
  const load = async (signal: AbortSignal) => { signals.push(signal); };
  const first = startReviewEffect(load); first();
  const second = startReviewEffect(load); await Promise.resolve();
  assert.equal(signals.length, 1); second(); assert.equal(signals[0].aborted, true);
  const third = startReviewEffect(load); await Promise.resolve(); assert.equal(signals.length, 2); third();
  assert.doesNotMatch(readFileSync("src/components/accounting/financial-review-workbench.tsx", "utf8"), /logReview|console\./);
  console.log("Review effect PASS: replay starts one GET, navigation cancellation retained, temporary console diagnostics removed");
}
void main();
