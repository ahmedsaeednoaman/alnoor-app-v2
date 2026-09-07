import assert from "node:assert/strict";
import { assertFieldDeletionAllowed, assertSectionDeletionAllowed, validateDynamicValue, validateFieldConfiguration, WorkFormDomainError } from "../src/lib/work-forms/validation";
import type { FieldConfiguration } from "../src/lib/work-forms/types";

const uuidA = "00000000-0000-4000-8000-000000000001";
const uuidB = "00000000-0000-4000-8000-000000000002";
const uuidC = "00000000-0000-4000-8000-000000000003";
const base: FieldConfiguration = { stableKey: "test_field", label: "اختبار", fieldType: "text", required: false, multiple: false, minSelections: null, maxSelections: null, smartDropdownSource: null, isFinancial: false, financialEffect: null };
const fails = (code: string, callback: () => unknown) => assert.throws(callback, (error) => error instanceof WorkFormDomainError && error.code === code);
const smart = (required: boolean, multiple: boolean, minSelections: number | null = null, maxSelections: number | null = null): FieldConfiguration => ({ ...base, fieldType: multiple ? "smart_multi" : "smart_single", required, multiple, minSelections, maxSelections, smartDropdownSource: "doctors" });

fails("FIELD_CARDINALITY_INVALID", () => validateFieldConfiguration({ ...base, multiple: true }));
fails("FIELD_CARDINALITY_INVALID", () => validateFieldConfiguration({ ...smart(false, false), multiple: true }));
fails("FIELD_CARDINALITY_INVALID", () => validateFieldConfiguration({ ...smart(false, true), multiple: false, minSelections: null }));
fails("REQUIRED_FIELD_MISSING", () => validateDynamicValue(smart(true, false), null));
assert.equal(validateDynamicValue(smart(false, false), null), null);
fails("MIN_SELECTIONS_NOT_MET", () => validateDynamicValue(smart(true, true, 1), []));
assert.deepEqual(validateDynamicValue(smart(false, true, 0), []), []);
fails("MIN_SELECTIONS_NOT_MET", () => validateDynamicValue(smart(false, true, 2), [uuidA]));
fails("MAX_SELECTIONS_EXCEEDED", () => validateDynamicValue(smart(false, true, 0, 2), [uuidA, uuidB, uuidC]));
fails("DUPLICATE_SELECTION", () => validateDynamicValue(smart(false, true), [uuidA, uuidA]));
fails("FINANCIAL_METADATA_INVALID", () => validateFieldConfiguration({ ...base, financialEffect: "subtract" }));
fails("HISTORICAL_FIELD_PROTECTED", () => assertFieldDeletionAllowed({ isSystemField: false, templateStatus: "published", historicallyUsed: true }));
assert.doesNotThrow(() => validateDynamicValue({ ...base, required: false }, null));
fails("SYSTEM_FIELD_PROTECTED", () => assertFieldDeletionAllowed({ isSystemField: true, templateStatus: "draft", historicallyUsed: false }));
fails("SYSTEM_SECTION_PROTECTED", () => assertSectionDeletionAllowed({ isSystemSection: true, templateStatus: "draft", hasFields: false }));
console.log("15 work-form validation and history-safety scenarios passed.");
