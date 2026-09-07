import { postgresClient } from "@/db/client";
import { resolveSmartDropdownSource } from "@/lib/work-forms/registry";
import type { SmartDropdownSource } from "@/lib/work-forms/types";
import { OperationDomainError } from "@/lib/operations/api";

type Executor = Pick<typeof postgresClient, "unsafe">;
type Row = Record<string, string | number | boolean | null | Date>;
export type PrintAuth = { id: string; permissions: string[] };
export type PrintableField = {
  id: string;
  stableKey: string;
  label: string;
  fieldType: string;
  value: string | string[];
  isFinancial: boolean;
};
export type PrintProjection = {
  operation: {
    id: string;
    type: string;
    dailySequence: number;
    date: string;
    time: string;
    caseName: string;
    hospital: string | null;
    contractEntity: string | null;
    reference: string | null;
  };
  template: { id: string; version: number; name: string };
  sections: Array<{ id: string; label: string; fields: PrintableField[] }>;
  financial: null | {
    mainAmount: number;
    additions: number;
    deductions: number;
    finalBalance: number;
    totalItems: number;
    doctorAccountAmount: number;
    paid: number;
    remaining: number;
    posted: boolean;
    doctorBalanceReceived: boolean;
    items: Array<{
      description: string;
      amount: string | null;
      kind: string;
      financialEffect: string;
    }>;
  };
};

const money = (value: unknown) => Number(value ?? 0);
const formatter = (fieldType: string, value: unknown): string | string[] => {
  if (Array.isArray(value)) return value.map(String);
  if (value == null || value === "") return "";
  if (fieldType === "boolean")
    return value === true || value === "true" ? "نعم" : "لا";
  if (fieldType === "money")
    return new Intl.NumberFormat("ar-EG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value));
  if (fieldType === "number")
    return new Intl.NumberFormat("ar-EG").format(Number(value));
  if (fieldType === "date")
    return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" }).format(
      new Date(`${String(value)}T12:00:00`),
    );
  return String(value);
};
async function label(db: Executor, source: SmartDropdownSource, id: string) {
  const definition = resolveSmartDropdownSource(source);
  const rows = await db.unsafe<Array<{ name: string }>>(
    `select ${definition.labelColumn} name from "${definition.table}" where id=$1::uuid`,
    [id],
  );
  return rows[0]?.name ?? "عنصر غير متاح";
}
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
const coreSingle: Record<string, { id: string; name: string }> = {
  doctor: { id: "doctor_id", name: "doctor_name" },
  hospital: { id: "hospital_id", name: "hospital_name" },
  contract_entity: { id: "contract_entity_id", name: "contract_entity_name" },
  anesthesiologist: {
    id: "anesthesiologist_id",
    name: "anesthesiologist_name",
  },
  technician: { id: "technician_id", name: "technician_name" },
};

export async function getOperationPrintProjection(
  operationId: string,
  auth: PrintAuth,
  db: Executor = postgresClient,
): Promise<PrintProjection> {
  const [operation] = await db.unsafe<Row[]>(
    `select o.*,d.name doctor_name,h.name hospital_name,ce.name contract_entity_name,a.name anesthesiologist_name,t.name technician_name from operations o left join doctors d on d.id=o.doctor_id left join hospitals h on h.id=o.hospital_id left join contract_entities ce on ce.id=o.contract_entity_id left join anesthesiologists a on a.id=o.anesthesiologist_id left join technicians t on t.id=o.technician_id where o.id=$1::uuid and o.status='recorded'`,
    [operationId],
  );
  if (!operation)
    throw new OperationDomainError(
      404,
      "OPERATION_NOT_FOUND",
      "العملية غير موجودة أو غير متاحة للطباعة.",
    );
  if (!operation.form_template_id)
    throw new OperationDomainError(
      409,
      "HISTORICAL_TEMPLATE_REQUIRED",
      "لا يمكن طباعة سجل قديم بلا إصدار نموذج.",
    );
  const [template] = await db.unsafe<Row[]>(
    `select id,name,version from work_form_templates where id=$1::uuid`,
    [String(operation.form_template_id)],
  );
  if (!template)
    throw new OperationDomainError(
      409,
      "HISTORICAL_TEMPLATE_MISSING",
      "تعريف النموذج التاريخي غير متاح.",
    );
  const sections = await db.unsafe<Row[]>(
    `select id,label,sort_order from work_form_sections where template_id=$1::uuid and archived_at is null order by sort_order`,
    [template.id],
  );
  const fields = await db.unsafe<Row[]>(
    `select id,section_id,stable_key,label,field_type,smart_dropdown_source,is_financial,sort_order from work_form_fields where template_id=$1::uuid and archived_at is null and (show_in_print=true or stable_key in ('case_name','doctor','hospital','operation_date','operation_time','diagnosis','notes','procedures','equipment','consumables','anesthesia_type','anesthesiologist','technician','participants','side','session_count','reference_number')) order by section_id,sort_order`,
    [template.id],
  );
  const scalar = await db.unsafe<Row[]>(
    `select * from operation_field_values where operation_id=$1::uuid`,
    [operationId],
  );
  const scalarMap = new Map(scalar.map((row) => [String(row.field_id), row]));
  const multi = await db.unsafe<Row[]>(
    `select field_id,reference_id,sort_order from operation_field_reference_values where operation_id=$1::uuid order by field_id,sort_order`,
    [operationId],
  );
  const multiMap = new Map<string, string[]>();
  for (const row of multi)
    multiMap.set(String(row.field_id), [
      ...(multiMap.get(String(row.field_id)) ?? []),
      String(row.reference_id),
    ]);
  const relations: Record<
    string,
    { source: SmartDropdownSource; query: string }
  > = {
    procedures: {
      source: "procedures",
      query: `select p.id,p.name from operation_procedures x left join procedures p on p.id=x.procedure_id where x.operation_id=$1::uuid order by x.procedure_id`,
    },
    equipment: {
      source: "equipment",
      query: `select e.id,e.name from operation_equipment x left join equipment e on e.id=x.equipment_id where x.operation_id=$1::uuid order by x.equipment_id`,
    },
    consumables: {
      source: "consumables",
      query: `select c.id,c.name from operation_consumables x left join consumables c on c.id=x.consumable_id where x.operation_id=$1::uuid order by x.consumable_id`,
    },
  };
  const projected = new Map<string, PrintableField[]>();
  for (const field of fields) {
    let value: string | string[] = "";
    const stableKey = String(field.stable_key);
    const fieldType = String(field.field_type);
    if (coreScalar[stableKey])
      value = formatter(fieldType, operation[coreScalar[stableKey]]);
    else if (coreSingle[stableKey])
      value = formatter(fieldType, operation[coreSingle[stableKey].name]);
    else if (relations[stableKey]) {
      const rows = await db.unsafe<Row[]>(relations[stableKey].query, [
        operationId,
      ]);
      value = rows.map((row) =>
        row.name ? String(row.name) : "عنصر غير متاح",
      );
    } else if (stableKey === "participants") {
      const rows = await db.unsafe<Row[]>(
        `select name from operation_participants where operation_id=$1::uuid order by id`,
        [operationId],
      );
      value = rows.map((row) => String(row.name));
    } else if (fieldType === "smart_multi") {
      const ids = multiMap.get(String(field.id)) ?? [];
      value = await Promise.all(
        ids.map((id) =>
          label(db, field.smart_dropdown_source as SmartDropdownSource, id),
        ),
      );
    } else {
      const stored = scalarMap.get(String(field.id));
      if (stored) {
        if (stored.reference_id)
          value = await label(
            db,
            field.smart_dropdown_source as SmartDropdownSource,
            String(stored.reference_id),
          );
        else
          value = formatter(
            fieldType,
            stored.text_value ??
              stored.number_value ??
              stored.money_value ??
              stored.date_value ??
              stored.time_value ??
              stored.boolean_value,
          );
      }
    }
    const meaningful = Array.isArray(value) ? value.length > 0 : value !== "";
    if (
      meaningful &&
      (!field.is_financial ||
        auth.permissions.includes("accounting.finance.view"))
    ) {
      const entry = {
        id: String(field.id),
        stableKey: String(field.stable_key),
        label: String(field.label),
        fieldType: String(field.field_type),
        value,
        isFinancial: Boolean(field.is_financial),
      };
      projected.set(String(field.section_id), [
        ...(projected.get(String(field.section_id)) ?? []),
        entry,
      ]);
    }
  }
  const financial = auth.permissions.includes("accounting.finance.view")
    ? await getFinancial(db, operationId)
    : null;
  return {
    operation: {
      id: String(operation.id),
      type: String(operation.type),
      dailySequence: Number(operation.daily_sequence),
      date: String(operation.operation_date),
      time: String(operation.operation_time),
      caseName: String(operation.case_name),
      hospital: operation.hospital_name
        ? String(operation.hospital_name)
        : null,
      contractEntity: operation.contract_entity_name
        ? String(operation.contract_entity_name)
        : null,
      reference: operation.reference_number
        ? String(operation.reference_number)
        : null,
    },
    template: {
      id: String(template.id),
      version: Number(template.version),
      name: String(template.name),
    },
    sections: sections
      .map((section) => ({
        id: String(section.id),
        label: String(section.label),
        fields: projected.get(String(section.id)) ?? [],
      }))
      .filter((section) => section.fields.length > 0),
    financial,
  };
}

async function getFinancial(
  db: Executor,
  operationId: string,
): Promise<PrintProjection["financial"]> {
  const [review] = await db.unsafe<Row[]>(
    `select fr.*, exists(select 1 from doctor_account_postings dp where dp.operation_id=fr.operation_id and dp.reversed=false) posted from operation_financial_reviews fr where operation_id=$1::uuid`,
    [operationId],
  );
  if (!review) return null;
  const items = await db.unsafe<Row[]>(
    `select kind,description,amount,financial_effect from operation_financial_items where review_id=$1::uuid order by created_at,id`,
    [review.id],
  );
  const [paidRow] = await db.unsafe<Row[]>(
    `select coalesce(sum(amount),0) paid from operation_financial_payments where review_id=$1::uuid`,
    [review.id],
  );
  const additions = items.reduce(
    (sum, item) => item.kind === "financial" && item.financial_effect === "add" ? sum + money(item.amount) : sum,
    0,
  );
  const deductions = items.reduce(
    (sum, item) => item.kind === "financial" && item.financial_effect === "subtract" ? sum + money(item.amount) : sum,
    0,
  );
  const totalItems = additions - deductions;
  const finalBalance = money(review.main_amount) + totalItems;
  const paid = money(paidRow?.paid);
  return {
    mainAmount: money(review.main_amount),
    additions,
    deductions,
    finalBalance,
    totalItems,
    doctorAccountAmount: finalBalance,
    paid,
    remaining: finalBalance - paid,
    posted: Boolean(review.posted),
    doctorBalanceReceived: Boolean(review.doctor_balance_received),
    items: items.map((item) => ({
      description: String(item.description),
      amount: item.amount == null ? null : String(item.amount),
      kind: String(item.kind),
      financialEffect: String(item.financial_effect),
    })),
  };
}

export async function getContractMonthlyReport(
  filters: {
    month: number;
    year: number;
    hospitalId?: string;
    contractEntityId?: string;
    search?: string;
  },
  auth: PrintAuth,
  db: Executor = postgresClient,
) {
  const conditions = [
      "o.status='recorded'",
      "o.type='contract'",
      "extract(month from o.operation_date)=$1",
      "extract(year from o.operation_date)=$2",
    ],
    params: Array<string | number> = [filters.month, filters.year];
  const add = (sql: string, value: string) => {
    params.push(value);
    conditions.push(sql.replace("?", `$${params.length}`));
  };
  if (filters.hospitalId) add("o.hospital_id=?::uuid", filters.hospitalId);
  if (filters.contractEntityId)
    add("o.contract_entity_id=?::uuid", filters.contractEntityId);
  if (filters.search) {
    params.push(filters.search);
    conditions.push(
      `(o.case_name ilike '%'||$${params.length}||'%' or coalesce(o.reference_number,'') ilike '%'||$${params.length}||'%')`,
    );
  }
  const rows = await db.unsafe<Row[]>(
    `select o.id,o.operation_date,o.daily_sequence,o.case_name,o.reference_number,h.name hospital_name,ce.name contract_entity_name,coalesce(fr.main_amount,0) value from operations o left join hospitals h on h.id=o.hospital_id left join contract_entities ce on ce.id=o.contract_entity_id left join operation_financial_reviews fr on fr.operation_id=o.id where ${conditions.join(" and ")} order by o.operation_date asc,o.daily_sequence asc,o.id asc`,
    params,
  );
  const projections = await Promise.all(
    rows.map((row) => getOperationPrintProjection(String(row.id), auth, db)),
  );
  return {
    month: filters.month,
    year: filters.year,
    filters,
    total: rows.length,
    pageCount: Math.ceil(rows.length / 15),
    rows: rows.map((row, index) => ({
      sequence: index + 1,
      id: String(row.id),
      date: String(row.operation_date),
      dailySequence: Number(row.daily_sequence),
      caseName: String(row.case_name),
      reference: row.reference_number ? String(row.reference_number) : "",
      hospital: row.hospital_name ? String(row.hospital_name) : "",
      contractEntity: row.contract_entity_name
        ? String(row.contract_entity_name)
        : "",
      value: auth.permissions.includes("accounting.finance.view")
        ? money(row.value)
        : null,
      details: projections[index].sections.flatMap((section) =>
        section.fields
          .filter(
            (field) =>
              ![
                "case_name",
                "reference_number",
                "hospital",
                "contract_entity",
              ].includes(field.stableKey),
          )
          .map(
            (field) =>
              `${field.label}: ${Array.isArray(field.value) ? field.value.join("، ") : field.value}`,
          ),
      ),
    })),
  };
}
