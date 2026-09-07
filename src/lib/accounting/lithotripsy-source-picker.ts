import { getPublishedTemplate } from "@/lib/work-forms/service";
import type { FinancialEffect, SmartDropdownSource } from "@/lib/work-forms/types";

type FormField = {
  id: string;
  stableKey: string;
  label: string;
  fieldType: string;
  multiple: boolean;
  smartDropdownSource: SmartDropdownSource | null;
  reviewRole?: string;
  isFinancial: boolean;
  financialEffect: FinancialEffect | null;
  archivedAt?: string | null;
};

export type LithotripsyFinancialSourceCategory = {
  id: string;
  name: string;
  fieldId: string;
  stableKey: string;
  sourceType: string;
  catalogSource: SmartDropdownSource | null;
  multiple: boolean;
  supportsSpecific: boolean;
  defaultEffect: FinancialEffect;
};

export function financialSourceType(stableKey: string) {
  return stableKey === "consumables" ? "consumable" : stableKey === "stents" ? "stent" : stableKey;
}

export function deriveLithotripsyFinancialSources(fields: FormField[]): LithotripsyFinancialSourceCategory[] {
  return fields
    .filter((field) => !field.archivedAt && (field.reviewRole === "cost_source" || field.isFinancial))
    .map((field) => ({
      id: financialSourceType(field.stableKey),
      name: field.label,
      fieldId: field.id,
      stableKey: field.stableKey,
      sourceType: financialSourceType(field.stableKey),
      catalogSource: field.smartDropdownSource,
      multiple: field.multiple,
      supportsSpecific: Boolean(field.smartDropdownSource),
      defaultEffect: field.financialEffect ?? "subtract",
    }));
}

export async function listLithotripsyFinancialSources() {
  const template = await getPublishedTemplate("lithotripsy");
  const fields = template.sections.flatMap((section) => section.fields) as FormField[];
  return deriveLithotripsyFinancialSources(fields);
}
