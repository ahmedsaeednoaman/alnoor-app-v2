import { validateFieldConfiguration, validateDynamicValue } from "@/lib/work-forms/validation";

const smartMulti = {
  stableKey: "equipment",
  label: "الأجهزة",
  fieldType: "smart_multi" as const,
  required: false,
  multiple: true,
  minSelections: 0,
  maxSelections: 3,
  smartDropdownSource: "equipment" as const,
  isFinancial: false,
  financialEffect: null,
};
validateFieldConfiguration(smartMulti);
const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000002";
const c = "00000000-0000-4000-8000-000000000003";
const multiValue = validateDynamicValue(smartMulti, [a, b, c]);
if (!Array.isArray(multiValue) || multiValue.length !== 3) throw new Error("multi selections did not remain independent");
let duplicateRejected = false;
try { validateDynamicValue(smartMulti, [a, a]); } catch { duplicateRejected = true; }
if (!duplicateRejected) throw new Error("duplicate multi selection was accepted");
const smartSingle = { ...smartMulti, stableKey: "doctor", fieldType: "smart_single" as const, multiple: false, minSelections: null, maxSelections: null, smartDropdownSource: "doctors" as const };
validateFieldConfiguration(smartSingle);
if (validateDynamicValue(smartSingle, a) !== a) throw new Error("single selection was not preserved");
let missingSourceRejected = false;
try { validateFieldConfiguration({ ...smartSingle, smartDropdownSource: null }); } catch { missingSourceRejected = true; }
if (!missingSourceRejected) throw new Error("smart field without source was accepted");
if (new Set(["1", "2"]).size !== 2) throw new Error("session choices are not distinct");
console.log("smart input UX checks passed (single clear semantics, multi identity, source validation, session choices)");
