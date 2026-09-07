import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lithotripsyProfileInputSchema } from "@/app/api/v1/financial-reviews/pricing-profiles/lithotripsy/route";
import { assertUniqueFinancialSources, financialSourceIdentity } from "@/lib/accounting/lithotripsy-profiles";
import { deriveLithotripsyFinancialSources, listLithotripsyFinancialSources } from "@/lib/accounting/lithotripsy-source-picker";
import { financialSourceDisplayLabel } from "@/lib/accounting/lithotripsy-source-types";

async function main() {
  const actual = await listLithotripsyFinancialSources();
  assert.deepEqual(actual.map((source) => source.sourceType), ["equipment", "consumable", "stent", "anesthesiologist", "technician"]);
  assert.ok(actual.every((source) => source.fieldId && source.catalogSource && source.supportsSpecific), "Published sources must retain field and catalog identities");
  assert.equal(actual.find((source) => source.sourceType === "anesthesiologist")?.catalogSource, "anesthesiologists");
  assert.equal(actual.find((source) => source.sourceType === "technician")?.catalogSource, "technicians");

  const dynamic = deriveLithotripsyFinancialSources([{ id: "field-1", stableKey: "custom_supplies", label: "توريدات خاصة", fieldType: "smart_multi", multiple: true, smartDropdownSource: "consumables", reviewRole: "cost_source", isFinancial: false, financialEffect: "add" }]);
  assert.equal(dynamic[0]?.sourceType, "custom_supplies");
  assert.equal(dynamic[0]?.defaultEffect, "add");

  const referenceId = "11111111-1111-4111-8111-111111111111";
  assert.equal(financialSourceIdentity({ lineType: "linked_role", sourceType: "technician", sourceReferenceId: null }), "role:technician");
  assert.equal(financialSourceIdentity({ lineType: "linked_source", sourceType: "technician", sourceReferenceId: referenceId }), `source:technician:${referenceId}`);
  assert.equal(financialSourceIdentity({ lineType: "fixed_cost", sourceType: null, sourceReferenceId: null }), null);
  assert.equal(financialSourceDisplayLabel("الفني"), "الفني — افتراضي");
  assert.equal(financialSourceDisplayLabel("الفني", "السيد"), "الفني — السيد");

  const common = { name: "TEST", sessionNumber: 1 as const, procedureIds: [referenceId], isBase: false };
  const line = { stableKey: "technician_specific", lineType: "linked_source" as const, label: "الفني — السيد", defaultAmount: 650, effect: "subtract" as const, sourceType: "technician", sourceReferenceId: referenceId };
  assert.equal(lithotripsyProfileInputSchema.safeParse({ ...common, lines: [line] }).success, true, "Specific source must normalize through the API schema");
  assert.equal(lithotripsyProfileInputSchema.safeParse({ ...common, lines: [{ ...line, lineType: "linked_role", sourceReferenceId: null }] }).success, true, "Generic category source must remain supported");
  assert.equal(lithotripsyProfileInputSchema.safeParse({ ...common, lines: [{ stableKey: "fixed", lineType: "fixed_cost", label: "بند ثابت", defaultAmount: 200, effect: "subtract" }] }).success, true, "Fixed lines must remain compatible");
  assert.equal(lithotripsyProfileInputSchema.safeParse({ ...common, lines: [{ stableKey: "legacy", lineType: "session_cost", label: "بند قديم", defaultAmount: 300, effect: "subtract", sessionValue: 1 }] }).success, true, "Legacy lines must remain readable/saveable");
  assert.equal(new Set([financialSourceIdentity(line), financialSourceIdentity(line)]).size, 1, "Duplicate source identities must be detectable");
  assert.throws(() => assertUniqueFinancialSources([line, line]), /نفس المصدر المالي/);

  const component = readFileSync(resolve("src/components/accounting/lithotripsy-pricing-profiles.tsx"), "utf8");
  assert.match(component, /ما نوع البند؟/);
  assert.match(component, /onOptionChange=.*financialSourceDisplayLabel/);
  assert.match(component, /لا يمكن إضافة نفس المصدر المالي أكثر من مرة/);
  assert.doesNotMatch(component, /<option value="linked_(role|source)"/, "Raw line enums must not be rendered");
  console.log("Smart financial source picker checks passed");
}

void main().then(() => process.exit(0));
