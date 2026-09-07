import { postgresClient } from "@/db/client";
import type { FieldConfiguration, FieldType, OperationType, SmartDropdownSource, ReviewRole } from "./types";
import { assertFieldDeletionAllowed, assertSectionDeletionAllowed, validateDynamicValue, validateFieldConfiguration, WorkFormDomainError } from "./validation";
import { validateReferenceExists } from "./registry";

type Row = Record<string, unknown>;
type SeedField = Omit<FieldConfiguration, "isFinancial" | "financialEffect"> & {
  section: string;
  showInFinancialReview?: boolean;
  showInPrint?: boolean;
  isFinancial?: boolean;
  financialEffect?: "add" | "subtract" | "neutral" | null;
  reviewRole?: ReviewRole;
};
type SeedSection = { key: string; label: string };
const defaultReviewRole = (stableKey: string): ReviewRole => ["anesthesiologist", "technician", "equipment", "consumables", "stents"].includes(stableKey) ? "cost_source" : "context";
const field = (section: string, stableKey: string, label: string, fieldType: FieldType, required = false, source: SmartDropdownSource | null = null, multiple = false, extra: Partial<SeedField> = {}): SeedField => ({
  section, stableKey, label, fieldType, required, smartDropdownSource: source, multiple,
  minSelections: multiple ? (required ? 1 : 0) : null, maxSelections: null,
  isSystemField: true, isFinancial: false, financialEffect: null, reviewRole: defaultReviewRole(stableKey), ...extra,
});
const commonSections: SeedSection[] = [
  { key: "basic_information", label: "البيانات الأساسية" },
  { key: "procedures_equipment", label: "الإجراءات والتجهيزات" },
  { key: "medical_team", label: "الفريق الطبي" },
  { key: "notes", label: "الملاحظات" },
];
const commonFields: SeedField[] = [
  field("basic_information", "case_name", "اسم الحالة", "text", true),
  field("basic_information", "doctor", "الطبيب", "smart_single", true, "doctors"),
  field("basic_information", "hospital", "المستشفى", "smart_single", true, "hospitals"),
  field("basic_information", "operation_date", "التاريخ", "date", true),
  field("basic_information", "operation_time", "الوقت", "time", true),
  field("basic_information", "diagnosis", "التشخيص", "textarea"),
  field("procedures_equipment", "procedures", "الإجراءات المنفذة", "smart_multi", true, "procedures", true),
  field("procedures_equipment", "equipment", "الأجهزة / المناظير", "smart_multi", false, "equipment", true),
  field("procedures_equipment", "consumables", "المستلزمات", "smart_multi", false, "consumables", true),
    field("medical_team", "anesthesia_type", "نوع التخدير", "smart_single", false, "anesthesia_types"),
  field("medical_team", "anesthesiologist", "طبيب التخدير", "smart_single", false, "anesthesiologists"),
  field("medical_team", "technician", "الفني", "smart_single", false, "technicians"),
  field("medical_team", "participants", "المشاركون / التمريض", "text"),
  field("notes", "notes", "ملاحظات", "textarea"),
];
const initialDefinitions: Record<OperationType, { name: string; sections: SeedSection[]; fields: SeedField[] }> = {
  lithotripsy: {
    name: "نموذج التفتيت",
    sections: commonSections,
  fields: [...commonFields, field("procedures_equipment", "side", "الاتجاه", "select"), field("procedures_equipment", "session_count", "الجلسة", "select", true), field("procedures_equipment", "stents", "الدعامات", "smart_multi", false, "stents", true)],
  },
  endoscopy: {
    name: "نموذج المناظير",
    sections: commonSections,
    fields: [...commonFields, field("procedures_equipment", "operational_amount_received", "المبلغ المستلم تشغيلياً", "money", false, null, false, { showInFinancialReview: true })],
  },
  contract: {
    name: "نموذج التعاقد / التأمين",
    sections: [commonSections[0], { key: "contract_information", label: "بيانات التعاقد" }, commonSections[1], commonSections[3]],
    fields: [
      field("basic_information", "case_name", "اسم الحالة", "text", true),
      field("basic_information", "doctor", "الطبيب", "smart_single", false, "doctors"),
      field("basic_information", "hospital", "المستشفى", "smart_single", false, "hospitals"),
      field("basic_information", "operation_date", "التاريخ", "date", true),
      field("basic_information", "operation_time", "الوقت", "time", true),
      field("contract_information", "contract_entity", "جهة التعاقد / التأمين", "smart_single", false, "contract_entities", false, { showInFinancialReview: true, showInPrint: true }),
      field("contract_information", "reference_number", "الرقم الموحد / المرجع", "text", false, null, false, { showInFinancialReview: true, showInPrint: true }),
      field("procedures_equipment", "procedures", "الإجراءات المنفذة", "smart_multi", true, "procedures", true, { showInFinancialReview: true, showInPrint: true }),
      field("procedures_equipment", "equipment", "الأجهزة / الأدوات", "smart_multi", false, "equipment", true, { showInFinancialReview: true, showInPrint: true }),
      field("procedures_equipment", "consumables", "المستلزمات", "smart_multi", false, "consumables", true),
      field("notes", "notes", "ملاحظات", "textarea"),
    ],
  },
};

export async function bootstrapInitialWorkForms(userId: string | null) {
  await postgresClient.begin(async (tx) => {
    for (const type of Object.keys(initialDefinitions) as OperationType[]) {
      const existing = await tx.unsafe<Row[]>("SELECT id FROM work_form_templates WHERE operation_type=$1::operation_type AND status='published' LIMIT 1", [type]);
      let templateId = existing[0]?.id as string | undefined;
      if (!templateId) {
        const definition = initialDefinitions[type];
        const [template] = await tx.unsafe<Row[]>("INSERT INTO work_form_templates(operation_type,name,version,status,created_by_user_id,updated_by_user_id,published_at) VALUES($1::operation_type,$2,1,'published',$3::uuid,$3::uuid,now()) RETURNING id", [type, definition.name, userId]);
        templateId = String(template.id);
        const sectionIds = new Map<string, string>();
        for (const [index, section] of definition.sections.entries()) {
          const [created] = await tx.unsafe<Row[]>("INSERT INTO work_form_sections(template_id,stable_key,label,sort_order,is_system_section) VALUES($1::uuid,$2,$3,$4,true) RETURNING id", [templateId, section.key, section.label, index]);
          sectionIds.set(section.key, String(created.id));
        }
        const orders = new Map<string, number>();
        for (const item of definition.fields) {
          validateFieldConfiguration({
            stableKey: item.stableKey, label: item.label, fieldType: item.fieldType,
            required: item.required, multiple: item.multiple,
            minSelections: item.minSelections, maxSelections: item.maxSelections,
            smartDropdownSource: item.smartDropdownSource,
            isFinancial: item.isFinancial ?? false,
            financialEffect: item.financialEffect ?? null,
            isSystemField: item.isSystemField,
          });
          const sortOrder = orders.get(item.section) ?? 0;
          orders.set(item.section, sortOrder + 1);
          await tx.unsafe(`INSERT INTO work_form_fields(template_id,section_id,stable_key,label,field_type,required,multiple,sort_order,is_system_field,smart_dropdown_source,min_selections,max_selections,show_in_financial_review,review_role,show_in_print,is_financial,financial_effect)
            VALUES($1::uuid,$2::uuid,$3,$4,$5::work_form_field_type,$6,$7,$8,true,$9::work_form_reference_source,$10,$11,$12,$13::work_form_review_role,$14,$15,$16::work_form_financial_effect)`,
          [templateId, sectionIds.get(item.section)!, item.stableKey, item.label, item.fieldType, item.required, item.multiple, sortOrder, item.smartDropdownSource, item.minSelections, item.maxSelections, item.showInFinancialReview ?? false, item.reviewRole ?? defaultReviewRole(item.stableKey), item.showInPrint ?? false, item.isFinancial ?? false, item.financialEffect ?? null]);
        }
      }
      await tx.unsafe("UPDATE operations SET form_template_id=$2::uuid WHERE type=$1::operation_type AND form_template_id IS NULL", [type, templateId]);
    }
    if (userId) {
      for (const name of ["نصفي", "كلي"]) {
        await tx.unsafe(
          "INSERT INTO anesthesia_types(name,normalized_name,created_by_user_id) SELECT $1,$2,$3::uuid WHERE NOT EXISTS (SELECT 1 FROM anesthesia_types WHERE normalized_name=$2 AND archived_at IS NULL)",
          [name, name.toLocaleLowerCase("ar"), userId],
        );
      }
    }
  });
}

async function loadTemplate(where: string, params: Array<string | number>) {
  const templates = await postgresClient.unsafe<Row[]>(`SELECT id,operation_type AS "operationType",name,version,status,based_on_template_id AS "basedOnTemplateId",published_at AS "publishedAt",created_at AS "createdAt",updated_at AS "updatedAt" FROM work_form_templates WHERE ${where} LIMIT 1`, params);
  if (!templates[0]) throw new WorkFormDomainError(404, "WORK_FORM_TEMPLATE_NOT_FOUND", "إصدار النموذج غير موجود.");
  const rawTemplate = templates[0];
  const isoDate = (value: unknown) => value == null ? null : new Date(String(value)).toISOString();
  const template = {
    ...rawTemplate,
    id: rawTemplate.id,
    publishedAt: isoDate(rawTemplate.publishedAt),
    createdAt: isoDate(rawTemplate.createdAt),
    updatedAt: isoDate(rawTemplate.updatedAt),
  };
  const sections = await postgresClient.unsafe<Row[]>(`SELECT id,stable_key AS "stableKey",label,description,sort_order AS "sortOrder",is_system_section AS "isSystemSection",archived_at AS "archivedAt" FROM work_form_sections WHERE template_id=$1::uuid ORDER BY sort_order`, [String(template.id)]);
  const fields = await postgresClient.unsafe<Row[]>(`SELECT id,section_id AS "sectionId",stable_key AS "stableKey",label,description,field_type AS "fieldType",required,multiple,sort_order AS "sortOrder",is_system_field AS "isSystemField",smart_dropdown_source AS "smartDropdownSource",min_selections AS "minSelections",max_selections AS "maxSelections",show_in_form AS "showInForm",show_in_details AS "showInDetails",show_in_financial_review AS "showInFinancialReview",review_role AS "reviewRole",show_in_print AS "showInPrint",is_financial AS "isFinancial",financial_effect AS "financialEffect",archived_at AS "archivedAt" FROM work_form_fields WHERE template_id=$1::uuid ORDER BY section_id,sort_order`, [String(template.id)]);
  return { ...template, sections: sections.map((section) => ({ ...section, fields: fields.filter((item) => item.sectionId === section.id) })) };
}
export const getPublishedTemplate = (type: OperationType) => loadTemplate("operation_type=$1::operation_type AND status='published'", [type]);
export const getTemplateVersion = (type: OperationType, version: number) => loadTemplate("operation_type=$1::operation_type AND version=$2", [type, version]);
export const getDraftTemplate = (type: OperationType) => loadTemplate("operation_type=$1::operation_type AND status='draft' ORDER BY version DESC", [type]);

export async function createDraftTemplate(type: OperationType, userId: string) {
  return postgresClient.begin(async (tx) => {
    const existing = await tx.unsafe<Row[]>("SELECT id FROM work_form_templates WHERE operation_type=$1::operation_type AND status='draft'", [type]);
    if (existing[0]) throw new WorkFormDomainError(409, "DRAFT_ALREADY_EXISTS", "يوجد مسودة مفتوحة لهذا النموذج.");
    const [source] = await tx.unsafe<Row[]>("SELECT * FROM work_form_templates WHERE operation_type=$1::operation_type AND status='published' FOR UPDATE", [type]);
    if (!source) throw new WorkFormDomainError(404, "WORK_FORM_TEMPLATE_NOT_FOUND", "لا يوجد نموذج منشور.");
    const [draft] = await tx.unsafe<Row[]>("INSERT INTO work_form_templates(operation_type,name,version,status,based_on_template_id,created_by_user_id,updated_by_user_id) VALUES($1::operation_type,$2,$3,'draft',$4::uuid,$5::uuid,$5::uuid) RETURNING id,version", [type, String(source.name), Number(source.version) + 1, String(source.id), userId]);
    await tx.unsafe("INSERT INTO work_form_sections(id,template_id,stable_key,label,description,sort_order,is_system_section,archived_at) SELECT gen_random_uuid(),$2::uuid,stable_key,label,description,sort_order,is_system_section,archived_at FROM work_form_sections WHERE template_id=$1::uuid", [String(source.id), String(draft.id)]);
    await tx.unsafe(`INSERT INTO work_form_fields(template_id,section_id,stable_key,label,description,field_type,required,multiple,sort_order,is_system_field,smart_dropdown_source,min_selections,max_selections,show_in_form,show_in_details,show_in_financial_review,review_role,show_in_print,is_financial,financial_effect,archived_at)
      SELECT $2::uuid,ns.id,f.stable_key,f.label,f.description,f.field_type,f.required,f.multiple,f.sort_order,f.is_system_field,f.smart_dropdown_source,f.min_selections,f.max_selections,f.show_in_form,f.show_in_details,f.show_in_financial_review,f.review_role,f.show_in_print,f.is_financial,f.financial_effect,f.archived_at FROM work_form_fields f JOIN work_form_sections os ON os.id=f.section_id JOIN work_form_sections ns ON ns.template_id=$2::uuid AND ns.stable_key=os.stable_key WHERE f.template_id=$1::uuid`, [String(source.id), String(draft.id)]);
    return draft;
  });
}
export async function publishDraftTemplate(templateId: string, userId: string) {
  return postgresClient.begin(async (tx) => {
    const [draft] = await tx.unsafe<Row[]>("SELECT id,operation_type FROM work_form_templates WHERE id=$1::uuid AND status='draft' FOR UPDATE", [templateId]);
    if (!draft) throw new WorkFormDomainError(409, "DRAFT_NOT_PUBLISHABLE", "المسودة غير موجودة أو منشورة مسبقاً.");
    await tx.unsafe("UPDATE work_form_templates SET status='archived',updated_at=now(),updated_by_user_id=$2::uuid WHERE operation_type=$1::operation_type AND status='published'", [String(draft.operation_type), userId]);
    await tx.unsafe("UPDATE work_form_templates SET status='published',published_at=now(),updated_at=now(),updated_by_user_id=$2::uuid WHERE id=$1::uuid", [templateId, userId]);
  });
}
export async function deleteUnusedDraftField(fieldId: string) {
  const [fieldRow] = await postgresClient.unsafe<Row[]>(`SELECT f.id,f.is_system_field,t.status,EXISTS(SELECT 1 FROM operation_field_values v WHERE v.field_id=f.id) OR EXISTS(SELECT 1 FROM operation_field_reference_values v WHERE v.field_id=f.id) AS used FROM work_form_fields f JOIN work_form_templates t ON t.id=f.template_id WHERE f.id=$1::uuid`, [fieldId]);
  if (!fieldRow) throw new WorkFormDomainError(404, "FIELD_NOT_FOUND", "الحقل غير موجود.");
  assertFieldDeletionAllowed({ isSystemField: Boolean(fieldRow.is_system_field), templateStatus: fieldRow.status as "draft" | "published" | "archived", historicallyUsed: Boolean(fieldRow.used) });
  await postgresClient.unsafe("DELETE FROM work_form_fields WHERE id=$1::uuid", [fieldId]);
}
export async function deleteUnusedDraftSection(sectionId: string) {
  const [section] = await postgresClient.unsafe<Row[]>(`SELECT s.id,s.is_system_section,t.status,EXISTS(SELECT 1 FROM work_form_fields f WHERE f.section_id=s.id) AS has_fields FROM work_form_sections s JOIN work_form_templates t ON t.id=s.template_id WHERE s.id=$1::uuid`, [sectionId]);
  if (!section) throw new WorkFormDomainError(404, "SECTION_NOT_FOUND", "القسم غير موجود.");
  assertSectionDeletionAllowed({ isSystemSection: Boolean(section.is_system_section), templateStatus: section.status as "draft" | "published" | "archived", hasFields: Boolean(section.has_fields) });
  await postgresClient.unsafe("DELETE FROM work_form_sections WHERE id=$1::uuid", [sectionId]);
}
export async function validateDynamicValues(fields: Array<FieldConfiguration & { id: string }>, values: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const fieldDefinition of fields) {
    const value = validateDynamicValue(fieldDefinition, values[fieldDefinition.stableKey] as never);
    if (value !== null && fieldDefinition.smartDropdownSource) {
      for (const referenceId of Array.isArray(value) ? value : [value]) await validateReferenceExists(fieldDefinition.smartDropdownSource, String(referenceId));
    }
    result[fieldDefinition.stableKey] = value;
  }
  return result;
}
