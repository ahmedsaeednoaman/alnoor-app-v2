import { postgresClient } from "@/db/client";
import { requireLithotripsySession } from "@/lib/accounting/lithotripsy-sessions";
import { resolveSmartDropdownSource } from "@/lib/work-forms/registry";
import type {
  DynamicFieldValue,
  OperationType,
  SmartDropdownSource,
} from "@/lib/work-forms/types";
import {
  isCoreWorkField,
  loadAndValidateTemplateValues,
  persistCustomValue,
  anesthesiaLabel,
  type DynamicExecutor,
  type DynamicField,
} from "./dynamic";
import type { DynamicOperationPatch } from "./validation";
import { OperationDomainError } from "./api";

type AuthUser = { id: string; role: { code: string }; permissions: string[] };
type Row = Record<string, string | number | boolean | null | Date>;
type ReadExecutor = Pick<typeof postgresClient, "unsafe">;
const isEmployee = (user: AuthUser) => user.role.code === "employee";
const num = (value: unknown) => Number(value ?? 0);
const coreScalar: Record<string, string> = {
  case_name: "case_name",
  operation_date: "operation_date",
  operation_time: "operation_time",
  diagnosis: "diagnosis",
  notes: "notes",
  side: "side",
  session_count: "session_count",
  anesthesia_type: "anesthesia_type",
  operational_amount_received: "operational_amount_received",
  reference_number: "reference_number",
};
const coreSingle: Record<string, { id: string; label: string }> = {
  doctor: { id: "doctor_id", label: "doctor_name" },
  hospital: { id: "hospital_id", label: "hospital_name" },
  contract_entity: { id: "contract_entity_id", label: "contract_entity_name" },
  anesthesiologist: {
    id: "anesthesiologist_id",
    label: "anesthesiologist_name",
  },
  technician: { id: "technician_id", label: "technician_name" },
};
const fieldRow = (row: Row): DynamicField & Record<string, unknown> => ({
  id: String(row.id),
  sectionId: String(row.section_id),
  stableKey: String(row.stable_key),
  label: String(row.label),
  description: row.description as string | null,
  fieldType: row.field_type as DynamicField["fieldType"],
  required: Boolean(row.required),
  multiple: Boolean(row.multiple),
  sortOrder: Number(row.sort_order),
  isSystemField: Boolean(row.is_system_field),
  smartDropdownSource: row.smart_dropdown_source as SmartDropdownSource | null,
  minSelections: row.min_selections == null ? null : Number(row.min_selections),
  maxSelections: row.max_selections == null ? null : Number(row.max_selections),
  showInForm: Boolean(row.show_in_form),
  showInDetails: Boolean(row.show_in_details),
  showInFinancialReview: Boolean(row.show_in_financial_review),
  showInPrint: Boolean(row.show_in_print),
  isFinancial: Boolean(row.is_financial),
  financialEffect: row.financial_effect as DynamicField["financialEffect"],
  archivedAt: row.archived_at ? String(row.archived_at) : null,
});

async function referenceLabel(
  db: ReadExecutor,
  source: SmartDropdownSource,
  id: string | null,
) {
  if (!id) return "";
  const definition = resolveSmartDropdownSource(source);
  const rows = await db.unsafe<Array<{ name: string }>>(
    `SELECT ${definition.labelColumn} AS name FROM "${definition.table}" WHERE id=$1::uuid`,
    [id],
  );
  return rows[0]?.name ?? "عنصر غير متاح";
}
function canEditOperation(operation: Row, user: AuthUser) {
  if (operation.status === "cancelled") return false;
  if (!isEmployee(user) && user.permissions.includes("operations.edit"))
    return true;
  return (
    isEmployee(user) &&
    operation.created_by_user_id === user.id &&
    new Date(String(operation.created_at)).getTime() >=
      Date.now() - 48 * 60 * 60 * 1000
  );
}
async function finance(db: ReadExecutor, operationId: string) {
  const [review] = await db.unsafe<Row[]>(
    `SELECT fr.id,fr.status,fr.accounting_mode,fr.main_amount,fr.doctor_account_amount,fr.doctor_received_amount,fr.doctor_balance_received,fr.notes,coalesce((SELECT sum(case when kind='financial' and financial_effect='add' and case_line_state='included' then coalesce(effective_amount,amount) else 0 end) FROM operation_financial_items WHERE review_id=fr.id),0) additions,coalesce((SELECT sum(case when kind='financial' and financial_effect='subtract' and case_line_state='included' then coalesce(effective_amount,amount) else 0 end) FROM operation_financial_items WHERE review_id=fr.id),0) deductions,coalesce((SELECT sum(amount) FROM operation_financial_payments WHERE review_id=fr.id),0) paid,EXISTS(SELECT 1 FROM doctor_account_postings WHERE operation_id=fr.operation_id AND reversed=false) posted FROM operation_financial_reviews fr WHERE operation_id=$1::uuid`,
    [operationId],
  );
  if (!review) return null;
  const items = await db.unsafe<Row[]>(
    'SELECT id,kind,description,amount,financial_effect AS "financialEffect",source_type AS "sourceType",notes FROM operation_financial_items WHERE review_id=$1::uuid ORDER BY created_at,id',
    [String(review.id)],
  );
  const direct = review.accounting_mode === "direct_items";
  const due = direct ? num(review.doctor_account_amount) : num(review.main_amount) + num(review.additions) - num(review.deductions);
  const paid = direct ? num(review.doctor_received_amount) : num(review.paid);
  return {
    status: review.status,
    mainAmount: num(review.main_amount),
    doctorAccountAmount: num(review.doctor_account_amount),
    additionTotal: num(review.additions),
    deductionTotal: num(review.deductions),
    totalCosts: num(review.deductions),
    totalItems: direct ? due : num(review.additions) - num(review.deductions),
    finalBalance: direct ? Math.max(0, due - paid) : due,
    paid,
    remaining: Math.max(0, due - paid),
    posted: Boolean(review.posted),
    doctorBalanceReceived: Boolean(review.doctor_balance_received),
    notes: review.notes,
    items,
  };
}

export async function getDynamicOperationDetails(
  id: string,
  user: AuthUser,
  includeFinance: boolean,
  db: ReadExecutor = postgresClient,
) {
  const employeeClause = isEmployee(user)
    ? " AND o.created_by_user_id=$2::uuid AND o.operation_date >= current_date-6"
    : "";
  const params = isEmployee(user) ? [id, user.id] : [id];
  const [operation] = await db.unsafe<Row[]>(
    `SELECT o.*,d.name doctor_name,h.name hospital_name,ce.name contract_entity_name,a.name anesthesiologist_name,t.name technician_name,u.display_name created_by_name FROM operations o LEFT JOIN doctors d ON d.id=o.doctor_id LEFT JOIN hospitals h ON h.id=o.hospital_id LEFT JOIN contract_entities ce ON ce.id=o.contract_entity_id LEFT JOIN anesthesiologists a ON a.id=o.anesthesiologist_id LEFT JOIN technicians t ON t.id=o.technician_id JOIN users u ON u.id=o.created_by_user_id WHERE o.id=$1::uuid${employeeClause} LIMIT 1`,
    params,
  );
  if (!operation)
    throw new OperationDomainError(
      404,
      "OPERATION_NOT_FOUND",
      "العملية غير موجودة أو غير متاحة.",
    );
  const canEdit = canEditOperation(operation, user);
  const templateId = operation.form_template_id
    ? String(operation.form_template_id)
    : null;
  if (!templateId)
    return {
      operation: {
        id: operation.id,
        type: operation.type,
        status: operation.status,
        dailySequence: operation.daily_sequence,
        caseName: operation.case_name,
        operationDate: operation.operation_date,
        operationTime: operation.operation_time,
        createdAt: operation.created_at,
      },
      template: null,
      sections: [
        {
          id: "legacy",
          label: "بيانات العملية القديمة",
          description: null,
          fields: Object.entries({
            case_name: operation.case_name,
            operation_date: operation.operation_date,
            operation_time: operation.operation_time,
            doctor: operation.doctor_name,
            hospital: operation.hospital_name,
            notes: operation.notes,
          })
            .filter(([, value]) => value != null)
            .map(([stableKey, value]) => ({
              id: stableKey,
              stableKey,
              label: stableKey,
              value,
              display: String(value),
              fieldType: "text",
            })),
        },
      ],
      form: null,
      canEdit: false,
      editExpiresAt: null,
      canPrint: user.permissions.includes("printing.use"),
      ...(includeFinance ? { financial: await finance(db, id) } : {}),
    };
  const [template] = await db.unsafe<Row[]>(
    "SELECT id,name,version,operation_type,status FROM work_form_templates WHERE id=$1::uuid",
    [templateId],
  );
  if (!template)
    throw new OperationDomainError(
      409,
      "HISTORICAL_TEMPLATE_MISSING",
      "تعريف النموذج التاريخي غير متاح.",
    );
  const sectionRows = await db.unsafe<Row[]>(
    "SELECT id,stable_key,label,description,sort_order FROM work_form_sections WHERE template_id=$1::uuid AND archived_at IS NULL ORDER BY sort_order",
    [templateId],
  );
  const rawFields = await db.unsafe<Row[]>(
    "SELECT * FROM work_form_fields WHERE template_id=$1::uuid AND archived_at IS NULL ORDER BY section_id,sort_order",
    [templateId],
  );
  const fields = rawFields.map(fieldRow);
  const procedures = await db.unsafe<Row[]>(
    "SELECT p.id,p.name FROM operation_procedures op LEFT JOIN procedures p ON p.id=op.procedure_id WHERE op.operation_id=$1::uuid ORDER BY p.name NULLS LAST",
    [id],
  );
  const equipment = await db.unsafe<Row[]>(
    "SELECT e.id,e.name FROM operation_equipment oe LEFT JOIN equipment e ON e.id=oe.equipment_id WHERE oe.operation_id=$1::uuid ORDER BY e.name NULLS LAST",
    [id],
  );
  const consumables = await db.unsafe<Row[]>(
    "SELECT c.id,c.name,oc.quantity FROM operation_consumables oc LEFT JOIN consumables c ON c.id=oc.consumable_id WHERE oc.operation_id=$1::uuid ORDER BY c.name NULLS LAST",
    [id],
  );
  const stents = await db.unsafe<Row[]>(
    "SELECT s.id,s.name FROM operation_stents os LEFT JOIN stents s ON s.id=os.stent_id WHERE os.operation_id=$1::uuid ORDER BY os.sort_order,s.name NULLS LAST",
    [id],
  );
  const participants = await db.unsafe<Row[]>(
    "SELECT name,linked_user_id FROM operation_participants WHERE operation_id=$1::uuid ORDER BY id",
    [id],
  );
  const scalarRows = await db.unsafe<Row[]>(
    "SELECT field_id,text_value,number_value,money_value,date_value,time_value,boolean_value,reference_id FROM operation_field_values WHERE operation_id=$1::uuid",
    [id],
  );
  const scalarMap = new Map(
    scalarRows.map((row) => [String(row.field_id), row]),
  );
  const multiRows = await db.unsafe<Row[]>(
    "SELECT field_id,reference_id,sort_order FROM operation_field_reference_values WHERE operation_id=$1::uuid ORDER BY field_id,sort_order",
    [id],
  );
  const multiMap = new Map<string, string[]>();
  for (const row of multiRows) {
    const key = String(row.field_id),
      items = multiMap.get(key) ?? [];
    items.push(String(row.reference_id));
    multiMap.set(key, items);
  }
  const rawValues: Record<string, DynamicFieldValue> = {};
  const displayValues = new Map<string, string | string[]>();
  for (const field of fields) {
    let value: DynamicFieldValue = null,
      display: string | string[] = "";
    if (coreScalar[field.stableKey]) {
      const raw = operation[coreScalar[field.stableKey]];
      value =
        raw == null
          ? null
          : field.fieldType === "number"
            ? Number(raw)
            : field.fieldType === "money"
              ? String(raw)
              : String(raw);
      display = value == null ? "" : field.stableKey === "session_count" ? (String(value) === "1" ? "الجلسة الأولى" : String(value) === "2" ? "الجلسة الثانية" : `الجلسة رقم ${value}`) : String(value);
    } else if (coreSingle[field.stableKey]) {
      const adapter = coreSingle[field.stableKey];
      value = operation[adapter.id] ? String(operation[adapter.id]) : null;
      display = operation[adapter.label]
        ? String(operation[adapter.label])
        : "";
    } else if (
      field.stableKey === "procedures" ||
      field.stableKey === "equipment" ||
      field.stableKey === "consumables" ||
      field.stableKey === "stents"
    ) {
      const rows =
        field.stableKey === "procedures"
          ? procedures
          : field.stableKey === "equipment"
            ? equipment
            : field.stableKey === "consumables" ? consumables : stents;
      value = rows.map((row) => String(row.id)).filter((id) => id !== "null");
      display = rows.map((row) =>
        row.name ? String(row.name) : "عنصر غير متاح",
      );
    } else if (field.stableKey === "participants") {
      if (field.fieldType === "smart_multi") {
        value = participants.map((row) => row.linked_user_id ? String(row.linked_user_id) : "").filter(Boolean);
        display = participants.map((row) => String(row.name)).filter(Boolean);
      } else {
        value = participants.map((row) => String(row.name)).join("، ") || null;
        display = value ? String(value) : "";
      }
    } else if (field.fieldType === "smart_multi") {
      value = multiMap.get(field.id) ?? [];
      display = await Promise.all(
        (value as string[]).map((ref) =>
          referenceLabel(db, field.smartDropdownSource!, ref).then(
            (label) => label ?? "عنصر غير متاح",
          ),
        ),
      );
    } else {
      const stored = scalarMap.get(field.id);
      if (stored) {
        value = stored.reference_id
          ? String(stored.reference_id)
          : stored.text_value != null
            ? String(stored.text_value)
            : stored.number_value != null
              ? Number(stored.number_value)
              : stored.money_value != null
                ? String(stored.money_value)
                : stored.date_value != null
                  ? String(stored.date_value)
                  : stored.time_value != null
                    ? String(stored.time_value)
                    : stored.boolean_value == null
                      ? null
                      : Boolean(stored.boolean_value);
        display =
          field.fieldType === "smart_single"
            ? await referenceLabel(
                db,
                field.smartDropdownSource!,
                value as string,
              )
            : field.fieldType === "boolean"
              ? value
                ? "نعم"
                : "لا"
              : value == null
                ? ""
                : String(value);
      }
    }
    rawValues[field.stableKey] = value;
    displayValues.set(
      field.id,
      Array.isArray(display) ? display.filter(Boolean) : (display ?? ""),
    );
  }
  const sections = sectionRows.map((section) => ({
    id: String(section.id),
    stableKey: String(section.stable_key),
    label: String(section.label),
    description: section.description ? String(section.description) : null,
    fields: fields
      .filter((field) => field.sectionId === section.id && field.showInDetails)
      .map((field) => ({
        id: field.id,
        stableKey: field.stableKey,
        label: field.label,
        fieldType: field.fieldType,
        value: rawValues[field.stableKey],
        display: displayValues.get(field.id),
      })),
  }));
  const form = canEdit
    ? {
        id: String(template.id),
        operationType: template.operation_type as OperationType,
        name: String(template.name),
        version: Number(template.version),
        status: template.status,
        updatedAt: "",
        sections: sectionRows.map((section) => ({
          id: String(section.id),
          stableKey: String(section.stable_key),
          label: String(section.label),
          description: section.description ? String(section.description) : null,
          sortOrder: Number(section.sort_order),
          isSystemSection: false,
          archivedAt: null,
          fields: fields.filter(
            (field) => field.sectionId === section.id && field.showInForm,
          ),
        })),
        values: rawValues,
      }
    : null;
  return {
    operation: {
      id: operation.id,
      type: operation.type,
      status: operation.status,
      dailySequence: operation.daily_sequence,
      caseName: operation.case_name,
      operationDate: operation.operation_date,
      operationTime: operation.operation_time,
      createdAt: operation.created_at,
      createdByName: operation.created_by_name,
    },
    template: {
      id: template.id,
      name: template.name,
      version: template.version,
      status: template.status,
    },
    sections,
    form,
    canEdit,
    canCancel: user.permissions.includes("operations.cancel"),
    canPrint: user.permissions.includes("printing.use"),
    editExpiresAt:
      isEmployee(user) && operation.created_by_user_id === user.id
        ? new Date(
            new Date(String(operation.created_at)).getTime() +
              48 * 60 * 60 * 1000,
          ).toISOString()
        : null,
    ...(includeFinance ? { financial: await finance(db, id) } : {}),
  };
}

export async function updateDynamicOperation(
  id: string,
  input: DynamicOperationPatch,
  user: AuthUser,
) {
  return postgresClient.begin((tx) =>
    updateDynamicOperationInTransaction(tx, id, input, user),
  );
}

export async function updateDynamicOperationInTransaction(
  tx: DynamicExecutor,
  id: string,
  input: DynamicOperationPatch,
  user: AuthUser,
) {
  const [operation] = await tx.unsafe<Row[]>(
    "SELECT * FROM operations WHERE id=$1::uuid FOR UPDATE",
    [id],
  );
  if (!operation)
    throw new OperationDomainError(
      404,
      "OPERATION_NOT_FOUND",
      "العملية غير موجودة.",
    );
  const privileged =
      !isEmployee(user) && user.permissions.includes("operations.edit"),
    ownRecent =
      isEmployee(user) &&
      operation.created_by_user_id === user.id &&
      new Date(String(operation.created_at)).getTime() >=
        Date.now() - 48 * 60 * 60 * 1000 &&
      String(operation.operation_date) >=
        new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  if ((!privileged && !ownRecent) || operation.status === "cancelled")
    throw new OperationDomainError(
      403,
      "OPERATION_EDIT_WINDOW_CLOSED",
      "انتهت صلاحية تعديل العملية أو لا تملك الصلاحية.",
    );
  if (String(operation.form_template_id) !== input.formTemplateId)
    throw new OperationDomainError(
      409,
      "TEMPLATE_VERSION_IMMUTABLE",
      "لا يمكن تغيير إصدار نموذج العملية أثناء التعديل.",
    );
  const validated = await loadAndValidateTemplateValues(tx, {
    operationType: operation.type as OperationType,
    formTemplateId: input.formTemplateId,
    values: input.values,
  });
  if (
    String(validated.values.operation_date) !== String(operation.operation_date)
  )
    throw new OperationDomainError(
      409,
      "OPERATION_DATE_IMMUTABLE",
      "تاريخ العملية ورقمها اليومي ثابتان في التعديل الحالي.",
    );
  const has = (key: string) =>
      validated.fields.some((field) => field.stableKey === key),
    value = (key: string) =>
      has(key) ? validated.values[key] : operation[coreScalar[key] ?? ""];
  const nextDoctorId = has("doctor")
    ? validated.values.doctor
    : operation.doctor_id;
  if (String(nextDoctorId ?? "") !== String(operation.doctor_id ?? "")) {
    const [activePosting] = await tx.unsafe<Row[]>(
      "select id from doctor_account_postings where operation_id=$1::uuid and reversed=false limit 1",
      [id],
    );
    if (activePosting)
      throw new OperationDomainError(
        409,
        "POSTED_OPERATION_DOCTOR_IMMUTABLE",
        "لا يمكن تغيير الطبيب بعد ترحيل الحالة إلى حساب الطبيب.",
      );
  }
  const sessions =
    value("session_count") == null
      ? Number(operation.session_count)
      : Number(value("session_count"));
  const lithotripsySession = operation.type === "lithotripsy" ? await requireLithotripsySession(sessions, tx) : null;
  const equipmentIds = has("equipment")
      ? (validated.values.equipment as string[])
      : null,
    hospitalId = has("hospital")
      ? validated.values.hospital
      : operation.hospital_id;
  if (equipmentIds?.length) {
    const conflicts = await tx.unsafe<Row[]>(
      "SELECT id FROM equipment WHERE id=ANY($1::uuid[]) AND fixed_hospital_id IS NOT NULL AND fixed_hospital_id IS DISTINCT FROM $2::uuid",
      [equipmentIds, hospitalId],
    );
    if (conflicts.length)
      throw new OperationDomainError(
        400,
        "FIXED_EQUIPMENT_HOSPITAL_MISMATCH",
        "أحد الأجهزة المختارة مثبت في مستشفى آخر.",
      );
  }
  await tx.unsafe(
    `UPDATE operations SET operation_time=$2,case_name=$3,doctor_id=$4::uuid,hospital_id=$5::uuid,contract_entity_id=$6::uuid,reference_number=$7,diagnosis=$8,notes=$9,side=$10::operation_side,anesthesia_type=$11,anesthesiologist_id=$12::uuid,technician_id=$13::uuid,session_count=$14,lithotripsy_session_id=$15::uuid,operational_amount_received=$16::numeric,updated_by_user_id=$17::uuid,updated_at=now() WHERE id=$1::uuid`,
    [
      id,
      value("operation_time"),
      value("case_name"),
      nextDoctorId,
      has("hospital") ? validated.values.hospital : operation.hospital_id,
      has("contract_entity")
        ? validated.values.contract_entity
        : operation.contract_entity_id,
      value("reference_number"),
      value("diagnosis"),
      value("notes"),
      value("side"),
      await anesthesiaLabel(tx, String(value("anesthesia_type") ?? "")),
      has("anesthesiologist")
        ? validated.values.anesthesiologist
        : operation.anesthesiologist_id,
      has("technician") ? validated.values.technician : operation.technician_id,
      sessions,
      lithotripsySession?.id ?? null,
      value("operational_amount_received"),
      user.id,
    ],
  );
  const replace = async (
    table: string,
    column: string,
    _key: string,
    ids: string[],
  ) => {
    await tx.unsafe(`DELETE FROM ${table} WHERE operation_id=$1::uuid`, [id]);
    for (const ref of ids)
      await tx.unsafe(
        `INSERT INTO ${table}(operation_id,${column}${table === "operation_consumables" ? ",quantity" : ""}) VALUES($1::uuid,$2::uuid${table === "operation_consumables" ? ",1" : ""})`,
        [id, ref],
      );
  };
  if (has("procedures"))
    await replace(
      "operation_procedures",
      "procedure_id",
      "procedures",
      validated.values.procedures as string[],
    );
  if (has("equipment"))
    await replace(
      "operation_equipment",
      "equipment_id",
      "equipment",
      validated.values.equipment as string[],
    );
  if (has("consumables"))
    await replace(
      "operation_consumables",
      "consumable_id",
      "consumables",
      validated.values.consumables as string[],
    );
  if (has("participants")) {
    await tx.unsafe(
      "DELETE FROM operation_participants WHERE operation_id=$1::uuid",
      [id],
    );
    const participantValue = validated.values.participants;
    if (Array.isArray(participantValue)) {
      for (const linkedUserId of participantValue) {
        const users = await tx.unsafe<Row[]>("SELECT display_name FROM users WHERE id=$1::uuid", [linkedUserId]);
        if (users[0]) await tx.unsafe("INSERT INTO operation_participants(operation_id,role,name,linked_user_id) VALUES($1::uuid,'other',$2,$3::uuid)", [id, String(users[0].display_name), linkedUserId]);
      }
    } else {
      const names = String(participantValue ?? "").split("،").map((item) => item.trim()).filter(Boolean);
      for (const name of names) await tx.unsafe("INSERT INTO operation_participants(operation_id,role,name) VALUES($1::uuid,'other',$2)", [id, name]);
    }
  }
  for (const field of validated.fields.filter(
    (field) => !isCoreWorkField(field.stableKey) || (field.stableKey === "participants" && field.fieldType === "smart_multi"),
  )) {
    await tx.unsafe(
      "DELETE FROM operation_field_values WHERE operation_id=$1::uuid AND field_id=$2::uuid",
      [id, field.id],
    );
    await tx.unsafe(
      "DELETE FROM operation_field_reference_values WHERE operation_id=$1::uuid AND field_id=$2::uuid",
      [id, field.id],
    );
    await persistCustomValue(
      tx,
      id,
      field,
      validated.values[field.stableKey] ?? null,
    );
  }
  return { id };
}
