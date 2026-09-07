export const operationTypes = ["lithotripsy", "endoscopy", "contract"] as const;
export const fieldTypes = ["text", "textarea", "number", "money", "date", "time", "boolean", "select", "smart_single", "smart_multi"] as const;
export const smartDropdownSources = ["doctors", "hospitals", "procedures", "equipment", "consumables", "stents", "anesthesiologists", "technicians", "contract_entities", "anesthesia_types", "users"] as const;
export const financialEffects = ["add", "subtract", "neutral"] as const;
export type OperationType = (typeof operationTypes)[number];
export type FieldType = (typeof fieldTypes)[number];
export type SmartDropdownSource = (typeof smartDropdownSources)[number];
export type FinancialEffect = (typeof financialEffects)[number];
export const reviewRoles = ["context", "cost_source", "hidden"] as const;
export type ReviewRole = (typeof reviewRoles)[number];

export type FieldConfiguration = {
  stableKey: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  multiple: boolean;
  minSelections: number | null;
  maxSelections: number | null;
  smartDropdownSource: SmartDropdownSource | null;
  isFinancial: boolean;
  financialEffect: FinancialEffect | null;
  reviewRole?: ReviewRole;
  isSystemField?: boolean;
};

export type DynamicFieldValue = string | number | boolean | null | string[];
