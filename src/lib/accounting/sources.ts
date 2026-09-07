import { postgresClient } from "@/db/client";
import { resolveSmartDropdownSource } from "@/lib/work-forms/registry";

type Executor = Pick<typeof postgresClient, "unsafe">;
type Row = Record<string, unknown>;
export type FinancialSource = {
  sourceType: string;
  sourceId: string | null;
  sourceFieldId: string | null;
  sourceReferenceId: string | null;
  label: string;
  contextLabel: string;
  defaultEffect: "add" | "subtract" | "neutral";
};
export type OperationContext = { stableKey: string; label: string; value: string | string[] };

const core = (operation: Row, key: string): string | null => {
  const columns: Record<string, string> = {
    case_name: "case_name", operation_date: "operation_date", operation_time: "operation_time",
    doctor: "doctor_name", hospital: "hospital_name", contract_entity: "contract_entity_name",
    reference_number: "reference_number", diagnosis: "diagnosis", notes: "notes", side: "side",
    session_count: "session_count", anesthesia_type: "anesthesia_type",
    anesthesiologist: "anesthesiologist_name", technician: "technician_name",
  };
  const value = columns[key] ? operation[columns[key]] : null;
  return value == null ? null : String(value);
};
const labels: Record<string, string> = {
  case_name: "اسم الحالة", operation_date: "التاريخ", operation_time: "الوقت", doctor: "الطبيب",
  hospital: "المستشفى", contract_entity: "جهة التعاقد", reference_number: "المرجع", diagnosis: "التشخيص",
  notes: "الملاحظات", side: "الاتجاه", session_count: "رقم الجلسة", anesthesia_type: "نوع التخدير",
  anesthesiologist: "طبيب التخدير", technician: "الفني", procedures: "الإجراءات", equipment: "الأجهزة",
  consumables: "المستلزمات", stents: "الدعامات", participants: "المشاركون",
};
const defaultRole = (key: string) => ["anesthesiologist", "technician", "equipment", "consumables", "stents"].includes(key) ? "cost_source" : "context";
const sourceType = (key: string) => key === "consumables" ? "consumable" : key === "stents" ? "stent" : key;
const coreReference: Record<string, string> = {
  doctor: "doctor_id",
  hospital: "hospital_id",
  contract_entity: "contract_entity_id",
  anesthesiologist: "anesthesiologist_id",
  technician: "technician_id",
};

async function catalogLabel(db: Executor, source: string, id: string) {
  const definition = resolveSmartDropdownSource(source as never);
  const rows = await db.unsafe<Array<{ name: string }>>(`select ${definition.labelColumn} name from "${definition.table}" where id=$1::uuid`, [id]);
  return rows[0]?.name ?? "عنصر غير متاح";
}

export async function getOperationFinancialSources(operationId: string, db: Executor = postgresClient) {
  const [operation] = await db.unsafe<Row[]>(`select o.*,d.name doctor_name,h.name hospital_name,a.name anesthesiologist_name,t.name technician_name,ce.name contract_entity_name
    from operations o left join doctors d on d.id=o.doctor_id left join hospitals h on h.id=o.hospital_id left join anesthesiologists a on a.id=o.anesthesiologist_id left join technicians t on t.id=o.technician_id left join contract_entities ce on ce.id=o.contract_entity_id where o.id=$1::uuid`, [operationId]);
  if (!operation) return { context: [], costSources: [] as FinancialSource[] };
  const [template] = await db.unsafe<Row[]>("select form_template_id from operations where id=$1::uuid", [operationId]);
  const fields = template?.form_template_id ? await db.unsafe<Row[]>("select id,stable_key,label,field_type,smart_dropdown_source,review_role,financial_effect from work_form_fields where template_id=$1::uuid and archived_at is null order by section_id,sort_order", [String(template.form_template_id)]) : [];
  const scalar = await db.unsafe<Row[]>("select * from operation_field_values where operation_id=$1::uuid", [operationId]);
  const multi = await db.unsafe<Row[]>("select field_id,reference_id from operation_field_reference_values where operation_id=$1::uuid order by sort_order", [operationId]);
  const scalarMap = new Map(scalar.map((r) => [String(r.field_id), r]));
  const multiMap = new Map<string, string[]>();
  for (const row of multi) multiMap.set(String(row.field_id), [...(multiMap.get(String(row.field_id)) ?? []), String(row.reference_id)]);
  const context: OperationContext[] = [], costSources: FinancialSource[] = [];
  for (const field of fields) {
    const key = String(field.stable_key), role = String(field.review_role ?? defaultRole(key));
    let values: string[] = [];
    if (["procedures", "equipment", "consumables", "stents"].includes(key)) {
      const table = key === "procedures" ? "operation_procedures" : key === "equipment" ? "operation_equipment" : key === "consumables" ? "operation_consumables" : "operation_stents";
      const idColumn = key === "procedures" ? "procedure_id" : key === "equipment" ? "equipment_id" : key === "consumables" ? "consumable_id" : "stent_id";
      const catalog = key === "procedures" ? "procedures" : key === "equipment" ? "equipment" : key === "consumables" ? "consumables" : "stents";
      const rows = await db.unsafe<Row[]>(`select x.${idColumn} id,c.name from ${table} x join ${catalog} c on c.id=x.${idColumn} where x.operation_id=$1::uuid order by c.name`, [operationId]);
      values = rows.map((r) => String(r.name));
      if (role === "cost_source") rows.forEach((r) => costSources.push({ sourceType: sourceType(key), sourceId: String(r.id), sourceFieldId: String(field.id), sourceReferenceId: String(r.id), label: String(r.name), contextLabel: String(field.label || labels[key]), defaultEffect: field.financial_effect === "add" ? "add" : field.financial_effect === "neutral" ? "neutral" : "subtract" }));
    } else {
      const value = core(operation, key);
      if (value != null) values = [value];
      else if (field.smart_dropdown_source && scalarMap.get(String(field.id))?.reference_id) { const stored = scalarMap.get(String(field.id))!; values = [await catalogLabel(db, String(field.smart_dropdown_source), String(stored.reference_id))]; }
      else if (multiMap.has(String(field.id))) values = await Promise.all((multiMap.get(String(field.id)) ?? []).map((id) => catalogLabel(db, String(field.smart_dropdown_source), id)));
      else { const stored = scalarMap.get(String(field.id)); const raw = stored?.text_value ?? stored?.number_value ?? stored?.money_value ?? stored?.date_value ?? stored?.time_value ?? stored?.boolean_value; if (raw != null) values = [String(raw)]; }
      if (role === "cost_source" && values.length) { const stored = scalarMap.get(String(field.id)); const reference = coreReference[key] ? operation[coreReference[key]] : field.smart_dropdown_source && stored?.reference_id ? stored.reference_id : null; costSources.push({ sourceType: sourceType(key), sourceId: reference ? String(reference) : null, sourceFieldId: String(field.id), sourceReferenceId: reference ? String(reference) : null, label: values[0], contextLabel: String(field.label || labels[key]), defaultEffect: field.financial_effect === "add" ? "add" : field.financial_effect === "neutral" ? "neutral" : "subtract" }); }
    }
    if (values.length && role === "context") context.push({ stableKey: key, label: String(field.label || labels[key] || key), value: values.length === 1 ? values[0] : values });
  }
  return { context, costSources };
}
