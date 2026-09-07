import assert from "node:assert/strict";
import { groupFinancialReview, type FinancialReviewGroupItem } from "../src/lib/accounting/financial-review-grouping";

type Fixture = FinancialReviewGroupItem & { hospitalName?: string; contractEntityName?: string };
const row = (id: string, type: Fixture["type"], time: string, extra: Partial<Fixture> = {}): Fixture => ({
  id, type, operationDate: "2026-08-20", operationTime: time,
  dailySequence: Number(id.replace(/\D/g, "")) || 1, ...extra,
});

const litho = groupFinancialReview([
  row("A1", "lithotripsy", "08:00", { doctorId: "a", doctorName: "Doctor A" }),
  row("B1", "lithotripsy", "09:00", { doctorId: "b", doctorName: "Doctor B" }),
  row("A2", "lithotripsy", "11:00", { doctorId: "a", doctorName: "Doctor A" }),
  row("B2", "lithotripsy", "13:00", { doctorId: "b", doctorName: "Doctor B" }),
  row("A3", "lithotripsy", "15:00", { doctorId: "a", doctorName: "Doctor A" }),
], "lithotripsy");
assert.deepEqual(litho[0].groups.map((group) => group.label), ["Doctor A", "Doctor B"]);
assert.deepEqual(litho[0].groups[0].cases.map((item) => item.id), ["A1", "A2", "A3"]);
assert.deepEqual(litho[0].groups[1].cases.map((item) => item.id), ["B1", "B2"]);

const endoscopy = groupFinancialReview([
  row("E2", "endoscopy", "12:00", { doctorId: "a", doctorName: "Doctor A", hospitalId: "y", hospitalName: "Hospital Y" }),
  row("E1", "endoscopy", "09:00", { doctorId: "a", doctorName: "Doctor A", hospitalId: "x", hospitalName: "Hospital X" }),
], "endoscopy");
assert.equal(endoscopy[0].groups.length, 1);
assert.deepEqual(endoscopy[0].groups[0].cases.map((item) => item.hospitalName), ["Hospital X", "Hospital Y"]);

const contract = groupFinancialReview([
  row("C1", "contract", "08:30", { hospitalId: "a", hospitalName: "Hospital A", contractEntityName: "Entity X" }),
  row("C3", "contract", "09:30", { hospitalId: "b", hospitalName: "Hospital B", contractEntityName: "Entity Y" }),
  row("C2", "contract", "11:30", { hospitalId: "a", hospitalName: "Hospital A", contractEntityName: "Entity Z" }),
], "contract");
assert.deepEqual(contract[0].groups.map((group) => group.label), ["Hospital A", "Hospital B"]);
assert.deepEqual(contract[0].groups[0].cases.map((item) => item.contractEntityName), ["Entity X", "Entity Z"]);

console.log("Financial review grouping regression: PASS");
