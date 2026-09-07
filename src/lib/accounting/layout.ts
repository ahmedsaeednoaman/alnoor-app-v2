import { postgresClient } from "@/db/client";
import type { OperationType } from "@/lib/work-forms/types";
import { OperationDomainError } from "@/lib/operations/api";

type Executor = Pick<typeof postgresClient, "unsafe">;
type Row = Record<string, unknown>;
export const layoutKinds = ["system", "operation_field", "accountant_input", "calculated"] as const;
export const calculatedKeys = ["addition_total", "deduction_total", "total_costs", "final_balance"] as const;
export const widthValues = ["small", "medium", "large"] as const;
export type LayoutKind = (typeof layoutKinds)[number];
export type LayoutColumn = {
  id: string; operationType: OperationType; stableKey: string; label: string; kind: LayoutKind;
  sourceFieldStableKey: string | null; effect: "add" | "subtract" | "neutral"; sortOrder: number;
  active: boolean; visible: boolean; width: string; protected: boolean; updatedAt: string;
};
const labels: Record<string, string> = {
  case_name: "اسم الحالة", doctor: "الطبيب", hospital: "المستشفى", operation_date: "التاريخ", operation_time: "الوقت",
  procedures: "الإجراءات", side: "الاتجاه", anesthesia_type: "نوع التخدير", anesthesiologist: "طبيب التخدير",
  technician: "الفني", session_count: "رقم الجلسة", stents: "الدعامات", equipment: "الأجهزة / المناظير", consumables: "المستلزمات",
  reference_number: "الرقم الموحد / المرجع", contract_entity: "جهة التعاقد", operational_amount_received: "القيمة التشغيلية",
};
const row = (value: Row): LayoutColumn => ({
  id: String(value.id), operationType: value.operation_type as OperationType, stableKey: String(value.stable_key), label: String(value.label),
  kind: value.kind as LayoutKind, sourceFieldStableKey: value.source_field_stable_key == null ? null : String(value.source_field_stable_key),
  effect: value.effect as LayoutColumn["effect"], sortOrder: Number(value.sort_order), active: Boolean(value.active), visible: Boolean(value.visible),
  width: String(value.width), protected: Boolean(value.protected), updatedAt: new Date(String(value.updated_at)).toISOString(),
});
const defaults: Record<OperationType, Array<{ stableKey: string; label: string; kind: LayoutKind; source?: string; effect?: "add" | "subtract" | "neutral"; protected?: boolean }>> = {
  lithotripsy: [
    { stableKey: "row_number", label: "م", kind: "system", protected: true }, { stableKey: "day", label: "اليوم", kind: "system", protected: true },
    { stableKey: "operation_date", label: "التاريخ", kind: "operation_field", source: "operation_date", protected: true }, { stableKey: "doctor", label: "الطبيب", kind: "operation_field", source: "doctor", protected: true },
    { stableKey: "case_name", label: "اسم الحالة", kind: "operation_field", source: "case_name", protected: true }, { stableKey: "procedures", label: "الإجراءات", kind: "operation_field", source: "procedures" },
    { stableKey: "side", label: "الاتجاه", kind: "operation_field", source: "side" }, { stableKey: "anesthesia_type", label: "نوع التخدير", kind: "operation_field", source: "anesthesia_type" },
    { stableKey: "anesthesiologist", label: "طبيب التخدير", kind: "operation_field", source: "anesthesiologist" }, { stableKey: "technician", label: "الفني", kind: "operation_field", source: "technician" },
    { stableKey: "session_count", label: "رقم الجلسة", kind: "operation_field", source: "session_count" }, { stableKey: "stents", label: "الدعامات", kind: "operation_field", source: "stents" },
    { stableKey: "equipment", label: "الأجهزة / المناظير", kind: "operation_field", source: "equipment" }, { stableKey: "consumables", label: "المستلزمات", kind: "operation_field", source: "consumables" },
    { stableKey: "main_amount", label: "المبلغ الرئيسي", kind: "accountant_input", effect: "neutral", protected: true }, { stableKey: "operation_account", label: "حساب العملية", kind: "accountant_input" },
    { stableKey: "anesthesia_account", label: "حساب التخدير", kind: "accountant_input" }, { stableKey: "technician_account", label: "حساب الفني", kind: "accountant_input" },
    { stableKey: "nursing_workers", label: "تمريض وعمال", kind: "accountant_input" }, { stableKey: "session_expenses", label: "مصاريف الجلسة", kind: "accountant_input" },
    { stableKey: "addition_total", label: "إجمالي الإضافات", kind: "calculated" }, { stableKey: "deduction_total", label: "إجمالي الخصومات", kind: "calculated" },
    { stableKey: "total_costs", label: "إجمالي التكاليف", kind: "calculated" }, { stableKey: "final_balance", label: "الرصيد النهائي", kind: "calculated" },
  ],
  endoscopy: [
    { stableKey: "row_number", label: "م", kind: "system", protected: true }, { stableKey: "day", label: "اليوم", kind: "system", protected: true },
    { stableKey: "operation_date", label: "التاريخ", kind: "operation_field", source: "operation_date" }, { stableKey: "doctor", label: "الدكتور", kind: "operation_field", source: "doctor" },
    { stableKey: "case_name", label: "اسم الحالة", kind: "operation_field", source: "case_name" }, { stableKey: "hospital", label: "المستشفى", kind: "operation_field", source: "hospital" },
    { stableKey: "equipment", label: "الأجهزة المستخدمة", kind: "operation_field", source: "equipment" }, { stableKey: "technician", label: "الموظف / الفني", kind: "operation_field", source: "technician" },
    { stableKey: "main_amount", label: "المبلغ الرئيسي", kind: "accountant_input", effect: "neutral" }, { stableKey: "total_costs", label: "إجمالي التكاليف", kind: "calculated" }, { stableKey: "final_balance", label: "الرصيد النهائي", kind: "calculated" }, { stableKey: "procedures", label: "الإجراءات", kind: "operation_field", source: "procedures" },
  ],
  contract: [
    { stableKey: "row_number", label: "م", kind: "system", protected: true }, { stableKey: "operation_date", label: "التاريخ", kind: "operation_field", source: "operation_date" },
    { stableKey: "case_name", label: "اسم الحالة", kind: "operation_field", source: "case_name" }, { stableKey: "reference_number", label: "الرقم الموحد / المرجع", kind: "operation_field", source: "reference_number" },
    { stableKey: "hospital", label: "المستشفى", kind: "operation_field", source: "hospital" }, { stableKey: "contract_entity", label: "جهة التعاقد", kind: "operation_field", source: "contract_entity" },
    { stableKey: "procedures", label: "الإجراء / الجهاز", kind: "operation_field", source: "procedures" }, { stableKey: "main_amount", label: "المبلغ الرئيسي", kind: "accountant_input", effect: "neutral" },
    { stableKey: "total_costs", label: "إجمالي التكاليف", kind: "calculated" }, { stableKey: "final_balance", label: "الرصيد / الحالة", kind: "calculated" },
  ],
};
export async function ensureFinancialReviewLayout(type: OperationType, userId: string, db: Executor = postgresClient) {
  const [existing] = await db.unsafe<Row[]>("select id from financial_review_definitions where operation_type=$1::operation_type limit 1", [type]);
  if (!existing) for (const [sortOrder, item] of defaults[type].entries()) await db.unsafe(
    `insert into financial_review_definitions(operation_type,stable_key,label,kind,effect,source_field_stable_key,sort_order,active,visible,width,protected,created_by_user_id,updated_at) values($1::operation_type,$2,$3,$4::financial_review_definition_kind,$5::work_form_financial_effect,$6,$7,true,true,'medium',$8,$9::uuid,now())`,
    [type, item.stableKey, item.label, item.kind, item.effect ?? "subtract", item.source ?? null, sortOrder, item.protected ?? false, userId],
  );
  return getFinancialReviewLayout(type, db);
}
export async function getFinancialReviewLayout(type: OperationType, db: Executor = postgresClient) {
  const rows = await db.unsafe<Row[]>("select * from financial_review_definitions where operation_type=$1::operation_type and active=true order by sort_order,id", [type]);
  return rows.map(row);
}
export async function getOperationFieldSources(type: OperationType, db: Executor = postgresClient) {
  const rows = await db.unsafe<Row[]>("select stable_key,label,field_type,review_role,archived_at from work_form_fields f join work_form_templates t on t.id=f.template_id where t.operation_type=$1::operation_type and t.status='published' and f.archived_at is null and f.show_in_form=true order by f.sort_order", [type]);
  return rows.map((item) => ({ stableKey: String(item.stable_key), label: String(item.label || labels[String(item.stable_key)] || item.stable_key), fieldType: String(item.field_type), reviewRole: String(item.review_role) }));
}
function validateColumn(input: { kind: string; stableKey: string; sourceFieldStableKey?: string | null; effect?: string; width?: string }) {
  if (!layoutKinds.includes(input.kind as LayoutKind)) throw new OperationDomainError(400, "LAYOUT_KIND_INVALID", "نوع العمود غير صالح.");
  if (!/^[a-z][a-z0-9_]*$/.test(input.stableKey)) throw new OperationDomainError(400, "LAYOUT_KEY_INVALID", "معرف العمود غير صالح.");
  if (input.width && !widthValues.includes(input.width as never)) throw new OperationDomainError(400, "LAYOUT_WIDTH_INVALID", "عرض العمود غير صالح.");
  if (input.kind === "calculated" && !calculatedKeys.includes(input.stableKey as never)) throw new OperationDomainError(400, "CALCULATED_KEY_INVALID", "المعادلة المحسوبة غير مدعومة.");
  if (input.kind === "operation_field" && !input.sourceFieldStableKey) throw new OperationDomainError(400, "LAYOUT_SOURCE_REQUIRED", "مصدر بيانات العمود مطلوب.");
  if (input.effect && !["add", "subtract", "neutral"].includes(input.effect)) throw new OperationDomainError(400, "LAYOUT_EFFECT_INVALID", "السلوك المالي غير صالح.");
}
export async function mutateFinancialReviewLayout(type: OperationType, action: string, input: Row, userId: string) {
  return postgresClient.begin(async (tx) => {
    if (action === "reorder") {
      const ids = Array.isArray(input.ids) ? input.ids.map(String) : [];
      const rows = await tx.unsafe<Row[]>("select id from financial_review_definitions where operation_type=$1::operation_type and active=true", [type]);
      if (ids.length !== rows.length || new Set(ids).size !== ids.length || ids.some((id) => !rows.some((row) => String(row.id) === id))) throw new OperationDomainError(400, "LAYOUT_ORDER_INVALID", "ترتيب الأعمدة غير صالح.");
      await tx.unsafe("update financial_review_definitions set sort_order=sort_order+10000,updated_at=now() where operation_type=$1::operation_type and active=true", [type]);
      for (const [index, id] of ids.entries()) await tx.unsafe("update financial_review_definitions set sort_order=$2,updated_at=now() where id=$1::uuid", [id, index]);
    } else if (action === "add") {
      validateColumn(input as never); const source = input.sourceFieldStableKey ?? null;
      if (input.kind === "operation_field") { const available = await getOperationFieldSources(type, tx); if (!available.some((field) => field.stableKey === source)) throw new OperationDomainError(400, "LAYOUT_SOURCE_INVALID", "مصدر الحقل لا ينتمي إلى هذا النوع."); }
      const [max] = await tx.unsafe<Row[]>("select coalesce(max(sort_order),-1)+1 value from financial_review_definitions where operation_type=$1::operation_type", [type]);
      await tx.unsafe("insert into financial_review_definitions(operation_type,stable_key,label,kind,effect,source_field_stable_key,sort_order,active,visible,width,protected,created_by_user_id,updated_at) values($1::operation_type,$2,$3,$4::financial_review_definition_kind,$5::work_form_financial_effect,$6,$7,true,true,$8,false,$9::uuid,now())", [type, String(input.stableKey), String(input.label), String(input.kind), String(input.effect ?? (input.kind === "accountant_input" ? "subtract" : "neutral")), source == null ? null : String(source), Number(max.value), String(input.width ?? "medium"), userId] as never[]);
    } else {
      const [current] = await tx.unsafe<Row[]>("select * from financial_review_definitions where id=$1::uuid and operation_type=$2::operation_type", [String(input.id), type]);
      if (!current) throw new OperationDomainError(404, "LAYOUT_COLUMN_NOT_FOUND", "العمود غير موجود.");
      if (action === "archive" && Boolean(current.protected)) throw new OperationDomainError(409, "LAYOUT_COLUMN_PROTECTED", "لا يمكن حذف هذا العمود النظامي.");
      if (action === "archive") await tx.unsafe("update financial_review_definitions set active=false,visible=false,updated_at=now() where id=$1::uuid", [String(input.id)]);
      else if (action === "visibility") await tx.unsafe("update financial_review_definitions set visible=$2,updated_at=now() where id=$1::uuid", [String(input.id), Boolean(input.visible)]);
      else if (action === "update") { validateColumn({ kind: String(current.kind), stableKey: String(current.stable_key), width: String(input.width ?? current.width) }); await tx.unsafe("update financial_review_definitions set label=coalesce($2,label),width=coalesce($3,width),effect=coalesce($4::work_form_financial_effect,effect),updated_at=now() where id=$1::uuid", [String(input.id), input.label == null ? null : String(input.label), input.width == null ? null : String(input.width), input.effect == null ? null : String(input.effect)] as never[]); }
    }
    return getFinancialReviewLayout(type, tx);
  });
}
