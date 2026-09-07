import type { FieldType, OperationType, SmartDropdownSource, ReviewRole } from "@/lib/work-forms/types";
export type BuilderField = {
  id: string; sectionId: string; stableKey: string; label: string; description: string | null;
  fieldType: FieldType; required: boolean; multiple: boolean; sortOrder: number; isSystemField: boolean;
  smartDropdownSource: SmartDropdownSource | null; minSelections: number | null; maxSelections: number | null;
  showInForm: boolean; showInDetails: boolean; showInFinancialReview: boolean; showInPrint: boolean;
  isFinancial: boolean; financialEffect: "add" | "subtract" | "neutral" | null; archivedAt: string | null;
  reviewRole?: ReviewRole;
};
export type BuilderSection = {
  id: string; stableKey: string; label: string; description: string | null; sortOrder: number;
  isSystemSection: boolean; archivedAt: string | null; fields: BuilderField[];
};
export type BuilderTemplate = {
  id: string; operationType: OperationType; name: string; version: number; status: "draft" | "published" | "archived";
  updatedAt: string; sections: BuilderSection[];
};
