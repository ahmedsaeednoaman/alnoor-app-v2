import { z } from "zod";
import { fieldTypes, financialEffects, operationTypes, smartDropdownSources, reviewRoles, type DynamicFieldValue, type FieldConfiguration } from "./types";

export class WorkFormDomainError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
    this.name = "WorkFormDomainError";
  }
}

export const operationTypeSchema = z.enum(operationTypes);
export const versionSchema = z.coerce.number().int().positive();
export const expectedUpdatedAtSchema = z.iso.datetime({ offset: true });
export const sectionInputSchema = z.object({ label: z.string().trim().min(2).max(180), description: z.string().trim().max(2000).nullable().optional() }).strict();
export const editableFieldSchema = z.object({
  label: z.string().trim().min(2).max(180),
  description: z.string().trim().max(2000).nullable().optional(),
  sectionId: z.string().uuid(),
  fieldType: z.enum(fieldTypes),
  required: z.boolean(),
  multiple: z.boolean(),
  minSelections: z.number().int().nonnegative().nullable(),
  maxSelections: z.number().int().nonnegative().nullable(),
  smartDropdownSource: z.enum(smartDropdownSources).nullable(),
  showInForm: z.boolean(),
  showInDetails: z.boolean(),
  showInFinancialReview: z.boolean(),
  showInPrint: z.boolean(),
  isFinancial: z.boolean(),
  financialEffect: z.enum(financialEffects).nullable(),
  reviewRole: z.enum(reviewRoles).optional(),
}).strict();
const optimistic = { expectedUpdatedAt: expectedUpdatedAtSchema };
export const draftMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_section"), ...optimistic, section: sectionInputSchema }).strict(),
  z.object({ action: z.literal("update_section"), ...optimistic, sectionId: z.string().uuid(), section: sectionInputSchema }).strict(),
  z.object({ action: z.literal("reorder_sections"), ...optimistic, sectionIds: z.array(z.string().uuid()).min(1).max(50) }).strict(),
  z.object({ action: z.literal("remove_section"), ...optimistic, sectionId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("add_field"), ...optimistic, field: editableFieldSchema }).strict(),
  z.object({ action: z.literal("update_field"), ...optimistic, fieldId: z.string().uuid(), field: editableFieldSchema }).strict(),
  z.object({ action: z.literal("reorder_fields"), ...optimistic, sectionId: z.string().uuid(), fieldIds: z.array(z.string().uuid()).max(200) }).strict(),
  z.object({ action: z.literal("move_field"), ...optimistic, fieldId: z.string().uuid(), sectionId: z.string().uuid(), index: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal("remove_field"), ...optimistic, fieldId: z.string().uuid() }).strict(),
]);
export const publishDraftSchema = z.object({ expectedUpdatedAt: expectedUpdatedAtSchema }).strict();
export const fieldConfigurationSchema = z.object({
  stableKey: z.string().regex(/^[a-z][a-z0-9_]*$/).max(100),
  label: z.string().trim().min(1).max(180),
  fieldType: z.enum(fieldTypes),
  required: z.boolean(),
  multiple: z.boolean(),
  minSelections: z.number().int().nonnegative().nullable(),
  maxSelections: z.number().int().nonnegative().nullable(),
  smartDropdownSource: z.enum(smartDropdownSources).nullable(),
  isFinancial: z.boolean(),
  financialEffect: z.enum(financialEffects).nullable(),
  reviewRole: z.enum(reviewRoles).optional(),
  isSystemField: z.boolean().optional(),
}).strict();

export function validateFieldConfiguration(input: FieldConfiguration): FieldConfiguration {
  const parsed = fieldConfigurationSchema.safeParse(input);
  if (!parsed.success) throw new WorkFormDomainError(400, "INVALID_FIELD_CONFIGURATION", "تعريف الحقل غير صالح.", parsed.error.flatten());
  const field = parsed.data;
  const inherentlySingle = ["text", "textarea", "number", "money", "date", "time", "boolean", "select", "smart_single"];
  if (inherentlySingle.includes(field.fieldType) && field.multiple) {
    throw new WorkFormDomainError(400, "FIELD_CARDINALITY_INVALID", "نوع الحقل لا يدعم الاختيار المتعدد.");
  }
  if (field.fieldType === "smart_multi" && !field.multiple) {
    throw new WorkFormDomainError(400, "FIELD_CARDINALITY_INVALID", "smart_multi يتطلب multiple=true.");
  }
  const isSmart = field.fieldType === "smart_single" || field.fieldType === "smart_multi";
  if (isSmart !== Boolean(field.smartDropdownSource)) {
    throw new WorkFormDomainError(400, "SMART_SOURCE_INVALID", "مصدر القائمة الذكية مطلوب فقط للحقول الذكية.");
  }
  if (!field.multiple && (field.minSelections != null || field.maxSelections != null)) {
    throw new WorkFormDomainError(400, "SELECTION_BOUNDS_INVALID", "حدود الاختيار متاحة للحقول المتعددة فقط.");
  }
  if (field.maxSelections != null && field.maxSelections < (field.minSelections ?? 0)) {
    throw new WorkFormDomainError(400, "SELECTION_BOUNDS_INVALID", "الحد الأقصى أقل من الحد الأدنى.");
  }
  if (!field.isFinancial && field.financialEffect !== null) {
    throw new WorkFormDomainError(400, "FINANCIAL_METADATA_INVALID", "الحقل غير المالي لا يقبل تأثيراً مالياً.");
  }
  if (field.isFinancial && field.financialEffect === null) {
    throw new WorkFormDomainError(400, "FINANCIAL_METADATA_INVALID", "التأثير المالي مطلوب للحقل المالي.");
  }
  return field;
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
export function validateDynamicValue(field: FieldConfiguration, value: DynamicFieldValue): DynamicFieldValue {
  validateFieldConfiguration({stableKey:field.stableKey,label:field.label,fieldType:field.fieldType,required:field.required,multiple:field.multiple,minSelections:field.minSelections,maxSelections:field.maxSelections,smartDropdownSource:field.smartDropdownSource,isFinancial:field.isFinancial,financialEffect:field.financialEffect,isSystemField:field.isSystemField});
  if (field.multiple) {
    if (!Array.isArray(value)) throw new WorkFormDomainError(400, "VALUE_CARDINALITY_INVALID", "قيمة الحقل يجب أن تكون قائمة.");
    if (new Set(value).size !== value.length) throw new WorkFormDomainError(400, "DUPLICATE_SELECTION", "لا يسمح بتكرار الاختيارات.");
    const minimum = field.required ? Math.max(1, field.minSelections ?? 0) : field.minSelections ?? 0;
    if (value.length < minimum) throw new WorkFormDomainError(400, "MIN_SELECTIONS_NOT_MET", "عدد الاختيارات أقل من الحد الأدنى.");
    if (field.maxSelections != null && value.length > field.maxSelections) throw new WorkFormDomainError(400, "MAX_SELECTIONS_EXCEEDED", "عدد الاختيارات أكبر من الحد الأقصى.");
    if (!value.every((item) => z.string().uuid().safeParse(item).success)) throw new WorkFormDomainError(400, "REFERENCE_INVALID", "أحد المراجع غير صالح.");
    return value;
  }
  const missing = value === null || value === undefined || value === "";
  if (missing) {
    if (field.required) throw new WorkFormDomainError(400, "REQUIRED_FIELD_MISSING", `${field.label} مطلوب.`);
    return null;
  }
  if (Array.isArray(value)) throw new WorkFormDomainError(400, "VALUE_CARDINALITY_INVALID", "الحقل يقبل قيمة واحدة فقط.");
  if (field.fieldType === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new WorkFormDomainError(400, "NUMBER_INVALID", `قيمة ${field.label} غير صالحة.`, { field: field.stableKey, label: field.label, expectedType: "number", receivedType: Array.isArray(value) ? "array" : typeof value });
  } else if (field.fieldType === "money") {
    if (typeof value !== "string" || !/^\d{1,12}(\.\d{1,2})?$/.test(value)) throw new WorkFormDomainError(400, "MONEY_INVALID", "القيمة المالية غير صالحة.");
  } else if (field.fieldType === "boolean") {
    if (typeof value !== "boolean") throw new WorkFormDomainError(400, "BOOLEAN_INVALID", "القيمة المنطقية غير صالحة.");
  } else if (field.fieldType === "date") {
    if (typeof value !== "string" || !datePattern.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new WorkFormDomainError(400, "DATE_INVALID", "التاريخ غير صالح.");
  } else if (field.fieldType === "time") {
    if (typeof value !== "string" || !timePattern.test(value)) throw new WorkFormDomainError(400, "TIME_INVALID", "الوقت غير صالح.");
  } else if (field.fieldType === "smart_single") {
    if (field.stableKey === "anesthesia_type" && typeof value === "string" && !z.string().uuid().safeParse(value).success) return value;
    if (typeof value !== "string" || !z.string().uuid().safeParse(value).success) throw new WorkFormDomainError(400, "REFERENCE_INVALID", "المرجع غير صالح.");
  } else if (typeof value !== "string") {
    throw new WorkFormDomainError(400, "TEXT_INVALID", "القيمة النصية غير صالحة.");
  }
  return value;
}

export function protectSystemField(field: { isSystemField: boolean }, action: "delete" | "archive") {
  if (field.isSystemField && action === "delete") throw new WorkFormDomainError(409, "SYSTEM_FIELD_PROTECTED", "لا يمكن حذف حقل نظام.");
}
export function protectSystemSection(section: { isSystemSection: boolean }, action: "delete" | "archive") {
  if (section.isSystemSection && action === "delete") throw new WorkFormDomainError(409, "SYSTEM_SECTION_PROTECTED", "لا يمكن حذف قسم نظام.");
}
export function assertFieldDeletionAllowed(field: { isSystemField: boolean; templateStatus: "draft" | "published" | "archived"; historicallyUsed: boolean }) {
  protectSystemField(field, "delete");
  if (field.templateStatus !== "draft" || field.historicallyUsed) {
    throw new WorkFormDomainError(409, "HISTORICAL_FIELD_PROTECTED", "الحقل مستخدم تاريخياً ويجب أرشفته بدلاً من حذفه.");
  }
}
export function assertSectionDeletionAllowed(section: { isSystemSection: boolean; templateStatus: "draft" | "published" | "archived"; hasFields: boolean }) {
  protectSystemSection(section, "delete");
  if (section.templateStatus !== "draft" || section.hasFields) {
    throw new WorkFormDomainError(409, "HISTORICAL_SECTION_PROTECTED", "القسم مرتبط بتعريفات ويجب أرشفته بدلاً من حذفه.");
  }
}
