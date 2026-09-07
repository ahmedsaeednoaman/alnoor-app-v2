import { postgresClient } from "@/db/client";
import type { DynamicFieldValue, FieldConfiguration, SmartDropdownSource } from "@/lib/work-forms/types";
import { resolveSmartDropdownSource } from "@/lib/work-forms/registry";
import { validateDynamicValue, WorkFormDomainError } from "@/lib/work-forms/validation";
import type { DynamicOperationInput } from "./validation";
import { requireLithotripsySession } from "@/lib/accounting/lithotripsy-sessions";

type AuthUser = { id: string };
type Row = Record<string, unknown>;
export type DynamicExecutor = { unsafe: typeof postgresClient.unsafe };
export type DynamicField = FieldConfiguration & { id: string; stableKey: string; isSystemField: boolean };

const scalarCore = new Set(["case_name", "operation_date", "operation_time", "diagnosis", "notes", "side", "session_count", "anesthesia_type", "operational_amount_received"]);
const singleReferenceCore = new Set(["doctor", "hospital", "contract_entity", "anesthesiologist", "technician"]);
const multiReferenceCore = new Set(["procedures", "equipment", "consumables", "stents"]);
export const isCoreWorkField = (key: string) => scalarCore.has(key) || singleReferenceCore.has(key) || multiReferenceCore.has(key) || key === "participants" || key === "reference_number";

function configuration(row: Row): DynamicField {
  return { id: String(row.id), stableKey: String(row.stable_key), label: String(row.label), fieldType: row.field_type as DynamicField["fieldType"], required: Boolean(row.required), multiple: Boolean(row.multiple), minSelections: row.min_selections == null ? null : Number(row.min_selections), maxSelections: row.max_selections == null ? null : Number(row.max_selections), smartDropdownSource: row.smart_dropdown_source as DynamicField["smartDropdownSource"], isFinancial: Boolean(row.is_financial), financialEffect: row.financial_effect as DynamicField["financialEffect"], reviewRole: row.review_role as DynamicField["reviewRole"], isSystemField: Boolean(row.is_system_field) };
}

async function validateReference(tx: DynamicExecutor, source: SmartDropdownSource, id: string) {
  const definition = resolveSmartDropdownSource(source);
  const rows = await tx.unsafe<Array<{ exists: boolean }>>(`SELECT EXISTS(SELECT 1 FROM "${definition.table}" WHERE id=$1::uuid) AS exists`, [id]);
  if (!rows[0]?.exists) throw new WorkFormDomainError(400, "REFERENCE_NOT_FOUND", "القيمة المرجعية غير موجودة.");
}

export async function loadAndValidateTemplateValues(tx: DynamicExecutor, input: DynamicOperationInput) {
  const [template] = await tx.unsafe<Row[]>("SELECT id,operation_type,status,published_at FROM work_form_templates WHERE id=$1::uuid FOR SHARE", [input.formTemplateId]);
  if (!template) throw new WorkFormDomainError(404, "WORK_FORM_TEMPLATE_NOT_FOUND", "إصدار النموذج غير موجود.");
  if (template.operation_type !== input.operationType) throw new WorkFormDomainError(400, "TEMPLATE_TYPE_MISMATCH", "إصدار النموذج لا يخص نوع العملية المحدد.");
  if (template.status === "draft") throw new WorkFormDomainError(409, "DRAFT_SUBMISSION_FORBIDDEN", "لا يمكن إنشاء عملية من مسودة غير منشورة.");
  if(template.status==="archived"&&!template.published_at)throw new WorkFormDomainError(409,"UNPUBLISHED_TEMPLATE_FORBIDDEN","لا يمكن إنشاء عملية من إصدار لم يسبق نشره.");
  const rows = await tx.unsafe<Row[]>("SELECT * FROM work_form_fields WHERE template_id=$1::uuid AND archived_at IS NULL AND show_in_form=true ORDER BY sort_order", [input.formTemplateId]);
  const fields = rows.map(configuration);
  const known = new Set(fields.map((field) => field.stableKey));
  const unknown = Object.keys(input.values).filter((key) => !known.has(key));
  if (unknown.length) throw new WorkFormDomainError(400, "UNKNOWN_DYNAMIC_FIELD", "يتضمن الطلب حقولاً غير معرفة في إصدار النموذج.", { fields: unknown });
  const values: Record<string, DynamicFieldValue> = {};
  for (const field of fields) {
    const value = validateDynamicValue(field, input.values[field.stableKey] as DynamicFieldValue);
    if (value !== null && field.smartDropdownSource && !(field.stableKey === "anesthesia_type" && typeof value === "string" && !uuidPattern.test(value))) for (const id of Array.isArray(value) ? value : [value]) await validateReference(tx, field.smartDropdownSource, String(id));
    values[field.stableKey] = value;
  }
  return { fields, values };
}

const text = (value: DynamicFieldValue | undefined) => typeof value === "string" && value.trim() ? value.trim() : null;
const reference = (value: DynamicFieldValue | undefined) => typeof value === "string" ? value : null;
const references = (value: DynamicFieldValue | undefined) => Array.isArray(value) ? value : [];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function anesthesiaLabel(tx: DynamicExecutor, value: DynamicFieldValue | undefined) {
  if (typeof value !== "string" || !uuidPattern.test(value)) return text(value);
  const rows = await tx.unsafe<Array<{ name: string }>>(
    "SELECT name FROM anesthesia_types WHERE id=$1::uuid AND archived_at IS NULL AND is_active=true",
    [value],
  );
  return rows[0]?.name ?? null;
}

export async function persistCustomValue(tx: DynamicExecutor, operationId: string, field: DynamicField, value: DynamicFieldValue) {
  if (value === null || (Array.isArray(value) && value.length === 0)) return;
  if (field.fieldType === "smart_multi") {
    for (const [index, id] of (value as string[]).entries()) await tx.unsafe("INSERT INTO operation_field_reference_values(operation_id,field_id,reference_id,sort_order) VALUES($1::uuid,$2::uuid,$3::uuid,$4)", [operationId, field.id, id, index]);
    return;
  }
  const target = field.fieldType === "number" ? ["number_value", "numeric"] : field.fieldType === "money" ? ["money_value", "numeric"] : field.fieldType === "date" ? ["date_value", "date"] : field.fieldType === "time" ? ["time_value", "varchar"] : field.fieldType === "boolean" ? ["boolean_value", "boolean"] : field.fieldType === "smart_single" ? ["reference_id", "uuid"] : ["text_value", "text"];
  await tx.unsafe(`INSERT INTO operation_field_values(operation_id,field_id,${target[0]}) VALUES($1::uuid,$2::uuid,$3::${target[1]})`, [operationId, field.id, value]);
}

export async function createDynamicOperationInTransaction(tx:DynamicExecutor,input: DynamicOperationInput, user: AuthUser) {
    const { fields, values } = await loadAndValidateTemplateValues(tx, input);
    const date = text(values.operation_date), time = text(values.operation_time), caseName = text(values.case_name);
    if (!date || !time || !caseName) throw new WorkFormDomainError(400, "CORE_FIELDS_REQUIRED", "اسم الحالة والتاريخ والوقت مطلوبة.");
    const side = text(values.side);
    if (side && !["right", "left", "bilateral"].includes(side)) throw new WorkFormDomainError(400, "SELECT_OPTION_INVALID", "قيمة الاتجاه غير صالحة.");
    const sessions = values.session_count == null ? 1 : Number(values.session_count);
    if (!Number.isInteger(sessions) || sessions < 1 || sessions > 100) throw new WorkFormDomainError(400, "SESSION_COUNT_INVALID", "عدد الجلسات غير صالح.");
    const lithotripsySession = input.operationType === "lithotripsy" ? await requireLithotripsySession(sessions, tx) : null;
    const equipmentIds=references(values.equipment),hospitalId=reference(values.hospital);
    if(equipmentIds.length){const conflicts=await tx.unsafe<Row[]>("SELECT name FROM equipment WHERE id=ANY($1::uuid[]) AND fixed_hospital_id IS NOT NULL AND fixed_hospital_id IS DISTINCT FROM $2::uuid",[equipmentIds,hospitalId]);if(conflicts.length)throw new WorkFormDomainError(400,"FIXED_EQUIPMENT_HOSPITAL_MISMATCH","أحد الأجهزة المختارة مثبت في مستشفى آخر.");}
    await tx.unsafe("SELECT pg_advisory_xact_lock(hashtext($1))", [date]);
    const [row] = await tx.unsafe<Row[]>(`INSERT INTO operations(type,operation_date,daily_sequence,operation_time,case_name,doctor_id,hospital_id,contract_entity_id,reference_number,diagnosis,notes,side,anesthesia_type,anesthesiologist_id,technician_id,session_count,lithotripsy_session_id,operational_amount_received,created_by_user_id,updated_by_user_id,form_template_id)
      VALUES($1::operation_type,$2::date,(SELECT coalesce(max(daily_sequence),0)+1 FROM operations WHERE operation_date=$2::date),$3,$4,$5::uuid,$6::uuid,$7::uuid,$8,$9,$10,$11::operation_side,$12,$13::uuid,$14::uuid,$15,$16::uuid,$17::numeric,$18::uuid,$18::uuid,$19::uuid) RETURNING id,daily_sequence AS "dailySequence"`, [input.operationType, date, time, caseName, reference(values.doctor), reference(values.hospital), reference(values.contract_entity), text(values.reference_number), text(values.diagnosis), text(values.notes), side, await anesthesiaLabel(tx, values.anesthesia_type), reference(values.anesthesiologist), reference(values.technician), sessions, lithotripsySession?.id ?? null, values.operational_amount_received ?? null, user.id, input.formTemplateId]);
    const operationId = String(row.id);
    for (const id of references(values.procedures)) await tx.unsafe("INSERT INTO operation_procedures(operation_id,procedure_id) VALUES($1::uuid,$2::uuid)", [operationId, id]);
    for (const id of equipmentIds) await tx.unsafe("INSERT INTO operation_equipment(operation_id,equipment_id) VALUES($1::uuid,$2::uuid)", [operationId, id]);
    for (const id of references(values.consumables)) await tx.unsafe("INSERT INTO operation_consumables(operation_id,consumable_id,quantity) VALUES($1::uuid,$2::uuid,1)", [operationId, id]);
    for (const [sortOrder, id] of references(values.stents).entries()) await tx.unsafe("INSERT INTO operation_stents(operation_id,stent_id,sort_order) VALUES($1::uuid,$2::uuid,$3)", [operationId, id, sortOrder]);
    const participants = values.participants;
    if (Array.isArray(participants)) {
      for (const linkedUserId of participants) {
        const users = await tx.unsafe<Row[]>("SELECT display_name FROM users WHERE id=$1::uuid", [linkedUserId]);
        if (users[0]) await tx.unsafe("INSERT INTO operation_participants(operation_id,role,name,linked_user_id) VALUES($1::uuid,'other',$2,$3::uuid)", [operationId, String(users[0].display_name), linkedUserId]);
      }
    } else {
      const participantText = text(participants);
      if (participantText) for (const name of participantText.split("،").map((item) => item.trim()).filter(Boolean)) await tx.unsafe("INSERT INTO operation_participants(operation_id,role,name) VALUES($1::uuid,'other',$2)", [operationId, name]);
    }
    for (const field of fields) if (!isCoreWorkField(field.stableKey) || (field.stableKey === "participants" && field.fieldType === "smart_multi")) await persistCustomValue(tx, operationId, field, values[field.stableKey] ?? null);
    return row;
}
export async function createDynamicOperation(input: DynamicOperationInput, user: AuthUser) {
  return postgresClient.begin((tx) => createDynamicOperationInTransaction(tx,input,user));
}
