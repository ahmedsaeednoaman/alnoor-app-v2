import { randomUUID } from "node:crypto";
import { postgresClient } from "@/db/client";
import type { z } from "zod";
import type { OperationType } from "./types";
import { assertSystemFieldMutation, systemFieldCapability } from "./policy";
import { draftMutationSchema, validateFieldConfiguration, WorkFormDomainError } from "./validation";
import { createDraftTemplate, getDraftTemplate, getPublishedTemplate } from "./service";

type Row = Record<string, unknown>;
type Mutation = z.infer<typeof draftMutationSchema>;
type Executor = { unsafe: typeof postgresClient.unsafe };
const stableKey = (kind: "section" | "field") => `custom_${kind}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
const iso = (value: unknown) => new Date(String(value)).toISOString();

export async function getOrCreateDraft(type: OperationType, userId: string) {
  try { return { published: await getPublishedTemplate(type), draft: await getDraftTemplate(type) }; }
  catch (error) {
    if (!(error instanceof WorkFormDomainError) || error.code !== "WORK_FORM_TEMPLATE_NOT_FOUND") throw error;
    try { await createDraftTemplate(type, userId); }
    catch (race) { if (!(race instanceof WorkFormDomainError) || race.code !== "DRAFT_ALREADY_EXISTS") throw race; }
    return { published: await getPublishedTemplate(type), draft: await getDraftTemplate(type) };
  }
}
async function lockDraft(tx: Executor, type: OperationType, expectedUpdatedAt: string) {
  const [draft] = await tx.unsafe<Row[]>("SELECT id,operation_type,updated_at,based_on_template_id FROM work_form_templates WHERE operation_type=$1::operation_type AND status='draft' FOR UPDATE", [type]);
  if (!draft) throw new WorkFormDomainError(404, "DRAFT_NOT_FOUND", "لا توجد مسودة لهذا النموذج.");
  if (iso(draft.updated_at) !== new Date(expectedUpdatedAt).toISOString()) throw new WorkFormDomainError(409, "STALE_DRAFT", "تم تعديل المسودة في نافذة أخرى. أعد تحميلها قبل الحفظ.");
  return draft;
}
async function touch(tx: Executor, id: string, userId: string) {
  await tx.unsafe("UPDATE work_form_templates SET updated_at=clock_timestamp(),updated_by_user_id=$2::uuid WHERE id=$1::uuid", [id, userId]);
}
async function normalizeSections(tx: Executor, templateId: string, ids: string[]) {
  const rows = await tx.unsafe<Row[]>("SELECT id FROM work_form_sections WHERE template_id=$1::uuid AND archived_at IS NULL ORDER BY sort_order,id", [templateId]);
  const actual = rows.map((row) => String(row.id));
  if (ids.length !== actual.length || new Set(ids).size !== ids.length || ids.some((id) => !actual.includes(id))) throw new WorkFormDomainError(400, "SECTION_ORDER_INVALID", "ترتيب الأقسام لا يطابق المسودة.");
  await tx.unsafe("UPDATE work_form_sections SET sort_order=sort_order+10000 WHERE template_id=$1::uuid", [templateId]);
  for (const [index, id] of ids.entries()) await tx.unsafe("UPDATE work_form_sections SET sort_order=$2,updated_at=now() WHERE id=$1::uuid", [id, index]);
}
async function normalizeFields(tx: Executor, templateId: string, sectionId: string, ids?: string[]) {
  const section = await tx.unsafe<Row[]>("SELECT id FROM work_form_sections WHERE id=$1::uuid AND template_id=$2::uuid AND archived_at IS NULL", [sectionId, templateId]);
  if (!section[0]) throw new WorkFormDomainError(400, "SECTION_RELATION_INVALID", "القسم لا ينتمي إلى المسودة.");
  const rows = await tx.unsafe<Row[]>("SELECT id FROM work_form_fields WHERE template_id=$1::uuid AND section_id=$2::uuid AND archived_at IS NULL ORDER BY sort_order,id", [templateId, sectionId]);
  const actual = rows.map((row) => String(row.id));
  const order = ids ?? actual;
  if (order.length !== actual.length || new Set(order).size !== order.length || order.some((id) => !actual.includes(id))) throw new WorkFormDomainError(400, "FIELD_ORDER_INVALID", "ترتيب الحقول لا يطابق القسم.");
  await tx.unsafe("UPDATE work_form_fields SET sort_order=sort_order+10000 WHERE template_id=$1::uuid AND section_id=$2::uuid", [templateId, sectionId]);
  for (const [index, id] of order.entries()) await tx.unsafe("UPDATE work_form_fields SET sort_order=$2,updated_at=now() WHERE id=$1::uuid", [id, index]);
}
function configuration(input: Extract<Mutation, { action: "add_field" | "update_field" }>["field"], stable = "custom_field") {
  return validateFieldConfiguration({ stableKey: stable, label: input.label, fieldType: input.fieldType, required: input.required, multiple: input.multiple, minSelections: input.minSelections, maxSelections: input.maxSelections, smartDropdownSource: input.smartDropdownSource, isFinancial: input.isFinancial, financialEffect: input.financialEffect, reviewRole: input.reviewRole });
}

export async function mutateDraft(type: OperationType, mutation: Mutation, userId: string) {
  await postgresClient.begin(async (tx) => {
    const draft = await lockDraft(tx, type, mutation.expectedUpdatedAt);
    const templateId = String(draft.id);
    if (mutation.action === "add_section") {
      const [order] = await tx.unsafe<Row[]>("SELECT coalesce(max(sort_order),-1)+1 value FROM work_form_sections WHERE template_id=$1::uuid", [templateId]);
      await tx.unsafe("INSERT INTO work_form_sections(template_id,stable_key,label,description,sort_order,is_system_section) VALUES($1::uuid,$2,$3,$4,$5,false)", [templateId, stableKey("section"), mutation.section.label, mutation.section.description ?? null, Number(order.value)]);
    } else if (mutation.action === "update_section") {
      const result = await tx.unsafe<Row[]>("UPDATE work_form_sections SET label=$3,description=$4,updated_at=now() WHERE id=$1::uuid AND template_id=$2::uuid AND archived_at IS NULL RETURNING id", [mutation.sectionId, templateId, mutation.section.label, mutation.section.description ?? null]);
      if (!result[0]) throw new WorkFormDomainError(404, "SECTION_NOT_FOUND", "القسم غير موجود في المسودة.");
    } else if (mutation.action === "reorder_sections") {
      await normalizeSections(tx, templateId, mutation.sectionIds);
    } else if (mutation.action === "remove_section") {
      const [section] = await tx.unsafe<Row[]>("SELECT is_system_section FROM work_form_sections WHERE id=$1::uuid AND template_id=$2::uuid AND archived_at IS NULL", [mutation.sectionId, templateId]);
      if (!section) throw new WorkFormDomainError(404, "SECTION_NOT_FOUND", "القسم غير موجود.");
      if (section.is_system_section) throw new WorkFormDomainError(409, "SYSTEM_SECTION_PROTECTED", "لا يمكن أرشفة قسم نظام.");
      await tx.unsafe("UPDATE work_form_fields SET archived_at=now(),show_in_form=false,updated_at=now() WHERE section_id=$1::uuid AND archived_at IS NULL", [mutation.sectionId]);
      await tx.unsafe("UPDATE work_form_sections SET archived_at=now(),updated_at=now() WHERE id=$1::uuid", [mutation.sectionId]);
    } else if (mutation.action === "add_field") {
      const config = configuration(mutation.field);
      await normalizeFields(tx, templateId, mutation.field.sectionId);
      const [order] = await tx.unsafe<Row[]>("SELECT coalesce(max(sort_order),-1)+1 value FROM work_form_fields WHERE template_id=$1::uuid AND section_id=$2::uuid", [templateId, mutation.field.sectionId]);
      await tx.unsafe(`INSERT INTO work_form_fields(template_id,section_id,stable_key,label,description,field_type,required,multiple,sort_order,is_system_field,smart_dropdown_source,min_selections,max_selections,show_in_form,show_in_details,show_in_financial_review,review_role,show_in_print,is_financial,financial_effect) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::work_form_field_type,$7,$8,$9,false,$10::work_form_reference_source,$11,$12,$13,$14,$15,$16,$17::work_form_review_role,$18,$19,$20::work_form_financial_effect)`, [templateId, mutation.field.sectionId, stableKey("field"), mutation.field.label, mutation.field.description ?? null, config.fieldType, config.required, config.multiple, Number(order.value), config.smartDropdownSource, config.minSelections, config.maxSelections, mutation.field.showInForm, mutation.field.showInDetails, mutation.field.showInFinancialReview, config.reviewRole ?? "hidden", mutation.field.showInPrint, config.isFinancial, config.financialEffect]);
    } else if (mutation.action === "update_field") {
      const [current] = await tx.unsafe<Row[]>(`SELECT f.*,s.template_id section_template_id FROM work_form_fields f JOIN work_form_sections s ON s.id=$3::uuid WHERE f.id=$1::uuid AND f.template_id=$2::uuid AND f.archived_at IS NULL`, [mutation.fieldId, templateId, mutation.field.sectionId]);
      if (!current || current.section_template_id !== draft.id) throw new WorkFormDomainError(400, "FIELD_RELATION_INVALID", "الحقل أو القسم لا ينتمي إلى المسودة.");
      const config = configuration(mutation.field, String(current.stable_key));
      if (current.is_system_field) assertSystemFieldMutation(type, { stableKey: String(current.stable_key), fieldType: current.field_type as never, required: Boolean(current.required), showInForm: Boolean(current.show_in_form), smartDropdownSource: current.smart_dropdown_source as never }, { fieldType: config.fieldType, required: config.required, showInForm: mutation.field.showInForm, smartDropdownSource: config.smartDropdownSource });
      const oldSection = String(current.section_id);
      await tx.unsafe(`UPDATE work_form_fields SET sort_order=CASE WHEN section_id<>$3::uuid THEN 10000 ELSE sort_order END,section_id=$3::uuid,label=$4,description=$5,field_type=$6::work_form_field_type,required=$7,multiple=$8,smart_dropdown_source=$9::work_form_reference_source,min_selections=$10,max_selections=$11,show_in_form=$12,show_in_details=$13,show_in_financial_review=$14,review_role=$15::work_form_review_role,show_in_print=$16,is_financial=$17,financial_effect=$18::work_form_financial_effect,updated_at=now() WHERE id=$1::uuid AND template_id=$2::uuid`, [mutation.fieldId, templateId, mutation.field.sectionId, mutation.field.label, mutation.field.description ?? null, config.fieldType, config.required, config.multiple, config.smartDropdownSource, config.minSelections, config.maxSelections, mutation.field.showInForm, mutation.field.showInDetails, mutation.field.showInFinancialReview, config.reviewRole ?? "hidden", mutation.field.showInPrint, config.isFinancial, config.financialEffect]);
      await normalizeFields(tx, templateId, oldSection);
      if (oldSection !== mutation.field.sectionId) await normalizeFields(tx, templateId, mutation.field.sectionId);
    } else if (mutation.action === "reorder_fields") {
      await normalizeFields(tx, templateId, mutation.sectionId, mutation.fieldIds);
    } else if (mutation.action === "move_field") {
      const [current] = await tx.unsafe<Row[]>("SELECT section_id FROM work_form_fields WHERE id=$1::uuid AND template_id=$2::uuid AND archived_at IS NULL", [mutation.fieldId, templateId]);
      if (!current) throw new WorkFormDomainError(404, "FIELD_NOT_FOUND", "الحقل غير موجود.");
      const oldSection = String(current.section_id);
      await normalizeFields(tx, templateId, mutation.sectionId);
      await tx.unsafe("UPDATE work_form_fields SET section_id=$3::uuid,sort_order=10000,updated_at=now() WHERE id=$1::uuid AND template_id=$2::uuid", [mutation.fieldId, templateId, mutation.sectionId]);
      await normalizeFields(tx, templateId, oldSection);
      const target = await tx.unsafe<Row[]>("SELECT id FROM work_form_fields WHERE template_id=$1::uuid AND section_id=$2::uuid AND archived_at IS NULL ORDER BY sort_order,id", [templateId, mutation.sectionId]);
      const ids = target.map((row) => String(row.id)).filter((id) => id !== mutation.fieldId);
      ids.splice(Math.min(mutation.index, ids.length), 0, mutation.fieldId);
      await normalizeFields(tx, templateId, mutation.sectionId, ids);
    } else if (mutation.action === "remove_field") {
      const [current] = await tx.unsafe<Row[]>("SELECT stable_key,is_system_field FROM work_form_fields WHERE id=$1::uuid AND template_id=$2::uuid AND archived_at IS NULL", [mutation.fieldId, templateId]);
      if (!current) throw new WorkFormDomainError(404, "FIELD_NOT_FOUND", "الحقل غير موجود.");
      if (current.is_system_field && !systemFieldCapability(type, String(current.stable_key)).canArchive) throw new WorkFormDomainError(409, "SYSTEM_FIELD_ARCHIVE_PROTECTED", "لا يمكن إخفاء هذا الحقل الأساسي.");
      const historical = await tx.unsafe<Row[]>("SELECT 1 FROM work_form_fields WHERE template_id=$1::uuid AND stable_key=$2", [String(draft.based_on_template_id), String(current.stable_key)]);
      if (!current.is_system_field && !historical[0]) await tx.unsafe("DELETE FROM work_form_fields WHERE id=$1::uuid", [mutation.fieldId]);
      else await tx.unsafe("UPDATE work_form_fields SET archived_at=now(),show_in_form=false,updated_at=now() WHERE id=$1::uuid", [mutation.fieldId]);
    }
    await touch(tx, templateId, userId);
  });
  return getDraftTemplate(type);
}

export async function validateDraftForPublish(type: OperationType, templateId: string) {
  const rows = await postgresClient.unsafe<Row[]>(`SELECT f.*,s.template_id section_template_id,s.archived_at section_archived FROM work_form_fields f JOIN work_form_sections s ON s.id=f.section_id WHERE f.template_id=$1::uuid AND f.archived_at IS NULL`, [templateId]);
  for (const row of rows) {
    if (row.section_template_id !== templateId || row.section_archived) throw new WorkFormDomainError(409, "PUBLISH_RELATION_INVALID", "يوجد حقل مرتبط بقسم غير صالح.");
    validateFieldConfiguration({ stableKey: String(row.stable_key), label: String(row.label), fieldType: row.field_type as never, required: Boolean(row.required), multiple: Boolean(row.multiple), minSelections: row.min_selections == null ? null : Number(row.min_selections), maxSelections: row.max_selections == null ? null : Number(row.max_selections), smartDropdownSource: row.smart_dropdown_source as never, isFinancial: Boolean(row.is_financial), financialEffect: row.financial_effect as never, isSystemField: Boolean(row.is_system_field) });
    if (row.field_type === "select" && row.stable_key !== "side") throw new WorkFormDomainError(409, "SELECT_OPTIONS_NOT_CONFIGURED", "القوائم الثابتة المخصصة غير متاحة للنشر قبل إضافة نموذج خيارات منظم.");
  }
  const requiredCore = ["case_name", "operation_date", "operation_time"];
  for (const key of requiredCore) if (!rows.some((row) => row.stable_key === key && row.is_system_field && row.show_in_form)) throw new WorkFormDomainError(409, "SYSTEM_INTEGRITY_INVALID", "أحد الحقول الأساسية مفقود أو مخفي.");
}

export async function publishDraft(type: OperationType, expectedUpdatedAt: string, userId: string) {
  await postgresClient.begin(async (tx) => {
    const draft = await lockDraft(tx, type, expectedUpdatedAt);
    await validateDraftForPublish(type, String(draft.id));
    await tx.unsafe("UPDATE work_form_templates SET status='archived',updated_at=now(),updated_by_user_id=$2::uuid WHERE operation_type=$1::operation_type AND status='published'", [type, userId]);
    await tx.unsafe("UPDATE work_form_templates SET status='published',published_at=now(),updated_at=clock_timestamp(),updated_by_user_id=$2::uuid WHERE id=$1::uuid", [String(draft.id), userId]);
  });
  return getPublishedTemplate(type);
}
