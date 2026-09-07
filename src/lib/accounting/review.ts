import { operationPaginationMetadata, resolveFinancialReviewPagination } from "@/lib/operations/validation";
import { postgresClient } from "@/db/client";
import { resolveSmartDropdownSource } from "@/lib/work-forms/registry";
import type {
  FinancialReviewFilters,
  FinancialReviewInput,
} from "@/lib/operations/validation";
import { OperationDomainError } from "@/lib/operations/api";
import { getOperationFinancialSources } from "./sources";
import { calculateFinancialSummary } from "./calculation";
import { resolveLithotripsyReviewDefaults, type LithotripsyResolvedPrices } from "./lithotripsy-pricing";
import { hydrateNewLithotripsyFinancialDraft } from "./lithotripsy-review-hydration";
import { calculateDirectPaymentSummary } from "./simple-review";
import { resolveServicePricing } from "./service-pricing";

type Executor = Pick<typeof postgresClient, "unsafe">;
type TxExecutor = Executor;
type Row = Record<string, unknown>;
type AuthUser = { id: string; permissions: string[] };
const money = (value: unknown) => Number(value ?? 0);
const cents = (value: unknown) => Math.round(money(value) * 100);
export const signedItemTotal = (
  items: Array<{ kind: string; financialEffect: string; amount?: unknown; effectiveAmount?: unknown; caseLineState?: string }>,
) =>
  items.reduce(
    (total, item) =>
      item.kind !== "financial" || item.financialEffect === "neutral" || item.caseLineState === "excluded"
        ? total
        : item.financialEffect === "subtract"
          ? total - cents(item.effectiveAmount ?? item.amount)
          : total + cents(item.effectiveAmount ?? item.amount),
    0,
  ) / 100;
const labels: Record<string, string> = {
  case_name: "اسم الحالة",
  operation_date: "التاريخ",
  operation_time: "الوقت",
  doctor: "الطبيب",
  hospital: "المستشفى",
  contract_entity: "جهة التعاقد",
  reference_number: "الرقم الموحد / المرجع",
  diagnosis: "التشخيص",
  notes: "الملاحظات",
  side: "الاتجاه",
  session_count: "الجلسة",
  anesthesia_type: "التخدير",
  anesthesiologist: "طبيب التخدير",
  technician: "الفني",
  procedures: "الإجراءات",
  equipment: "الأجهزة المستخدمة",
  consumables: "المستلزمات",
  participants: "المشاركون",
  operational_amount_received: "المبلغ المستلم تشغيلياً",
};
const coreValue = (operation: Row, key: string) => {
  const map: Record<string, string> = {
    case_name: "case_name",
    operation_date: "operation_date",
    operation_time: "operation_time",
    doctor: "doctor_name",
    hospital: "hospital_name",
    contract_entity: "contract_entity_name",
    reference_number: "reference_number",
    diagnosis: "diagnosis",
    notes: "notes",
    side: "side",
    session_count: "session_count",
    anesthesia_type: "anesthesia_type",
    anesthesiologist: "anesthesiologist_name",
    technician: "technician_name",
    participants: "participants",
    operational_amount_received: "operational_amount_received",
  };
  return operation[map[key]];
};
const coreReference: Record<string, string> = {
  doctor: "doctor_id",
  hospital: "hospital_id",
  contract_entity: "contract_entity_id",
  anesthesiologist: "anesthesiologist_id",
  technician: "technician_id",
};
async function refLabel(db: Executor, source: string, id: string) {
  const definition = resolveSmartDropdownSource(source as never);
  const rows = await db.unsafe<Array<{ name: string }>>(
    `SELECT ${definition.labelColumn} name FROM "${definition.table}" WHERE id=$1::uuid`,
    [id],
  );
  return rows[0]?.name ?? "عنصر غير متاح";
}
function reviewSummary(
  review: Row | null,
  items: Row[],
  payments: Row[],
  posted: boolean,
) {
  const mode = String(review?.accounting_mode ?? "main_amount") as "main_amount" | "direct_items";
  const paid = mode === "direct_items" && review?.doctor_received_amount != null
      ? money(review.doctor_received_amount)
      : payments.reduce((sum, row) => sum + money(row.amount), 0),
    doctor = money(review?.doctor_account_amount),
    payment = calculateDirectPaymentSummary(doctor, review?.doctor_received_amount == null && mode === "direct_items" ? null : paid);
  const calculation = calculateFinancialSummary(
    (review?.main_amount as number | string | null) ?? 0,
    items.map((row) => ({ kind: String(row.kind), financialEffect: String(row.financial_effect) as "add" | "subtract" | "neutral", amount: row.amount as number | string | null, effectiveAmount: row.effective_amount as number | string | null, caseLineState: (String(row.case_line_state ?? "included") as "included" | "excluded") })),
  );
  return {
    id: review?.id ?? null,
    status: review?.status ?? "awaiting_review",
    accountingMode: mode,
    mainAmount: money(review?.main_amount),
    doctorAccountAmount: doctor,
    doctorReceivedAmount: mode === "direct_items" && review?.doctor_received_amount != null ? money(review.doctor_received_amount) : null,
    paymentState: payment.state,
    notes: review?.notes ?? null,
    updatedAt: review?.updated_at
      ? new Date(String(review.updated_at)).toISOString()
      : null,
    items: items.map((row) => ({
      id: row.id,
      kind: row.kind,
      description: row.description,
      amount: row.amount == null ? null : String(row.amount),
      baseAmount: row.base_amount == null ? null : String(row.base_amount),
      adjustmentAmount: row.adjustment_amount == null ? null : String(row.adjustment_amount),
      effectiveAmount: row.effective_amount == null ? null : String(row.effective_amount),
      caseLineState: row.case_line_state ?? "included",
      financialEffect: row.financial_effect,
      sourceType: row.source_type,
      sourceFieldId: row.source_field_id,
      sourceReferenceId: row.source_reference_id,
      definitionId: row.definition_id,
      pricingProfileId: row.pricing_profile_id,
      pricingProfileLineId: row.pricing_profile_line_id,
      pricingProfileVersion: row.pricing_profile_version,
      servicePricingProfileId: row.service_pricing_profile_id,
      servicePricingItemId: row.service_pricing_item_id,
      servicePricingVersion: row.service_pricing_version,
      pricingOrigin: row.pricing_profile_line_type === "linked_source"
        ? "specific_source_default"
        : row.pricing_profile_line_type === "linked_role"
          ? "profile_role_default"
          : row.pricing_profile_line_type === "fixed_cost" || row.pricing_profile_line_type === "session_cost"
            ? "profile_fixed_line"
            : null,
      notes: row.notes,
    })),
    payments: payments.map((row) => ({
      id: row.id,
      amount: String(row.amount),
      notes: row.notes,
      paidAt: row.paid_at,
    })),
    totalItems: signedItemTotal(
      items.map((row) => ({
        kind: String(row.kind),
        financialEffect: String(row.financial_effect),
        amount: row.amount,
        effectiveAmount: row.effective_amount,
        caseLineState: String(row.case_line_state ?? "included"),
      })),
    ),
    paid,
    remaining: payment.remaining,
    posted,
    doctorBalanceReceived: Boolean(review?.doctor_balance_received),
    financialSummary: calculation,
  };
}

export async function listFinancialReviewRows(filters: FinancialReviewFilters) {
  const resolved = resolveFinancialReviewPagination(filters);
  const conditions = ["o.status='recorded'"],
    params: Array<string | number> = [];
  const add = (sql: string, value: string) => {
    params.push(value);
    conditions.push(sql.replace("?", `$${params.length}`));
  };
  if (filters.type) add("o.type=?::operation_type", filters.type);
  if (resolved.from) add("o.operation_date>=?::date", resolved.from);
  if (resolved.toExclusive) add("o.operation_date<?::date", resolved.toExclusive);
  if (filters.doctorId) add("o.doctor_id=?::uuid", filters.doctorId);
  if (filters.hospitalId) add("o.hospital_id=?::uuid", filters.hospitalId);
  if (filters.search) {
    params.push(filters.search);
    conditions.push(
      `(o.case_name ilike '%'||$${params.length}||'%' or coalesce(o.reference_number,'') ilike '%'||$${params.length}||'%')`,
    );
  }
  if (filters.reviewStatus)
    add(
      "coalesce(fr.status,'awaiting_review')=?::financial_review_status",
      filters.reviewStatus,
    );
  const fromSql = `FROM operations o left join operation_financial_reviews fr on fr.operation_id=o.id join users u on u.id=o.created_by_user_id WHERE ${conditions.join(" AND ")}`;
  const [countRow] = await postgresClient.unsafe<Array<{ total: string }>>(`SELECT count(*)::text total ${fromSql}`, params);
  const total = Number(countRow?.total ?? 0);
  if (!total && !resolved.legacyPaging) { resolved.page = 1; resolved.offset = 0; }
  const pageParams = resolved.pageSize === "all" ? [...params] : [...params, resolved.pageSize, resolved.offset];
  const pagingSql = resolved.pageSize === "all" ? "" : `LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`;
  const pageIds = total ? await postgresClient.unsafe<Array<{ id: string }>>(
    `SELECT o.id ${fromSql} ORDER BY o.operation_date desc,o.daily_sequence desc,o.id desc ${pagingSql}`, pageParams,
  ) : [];
  // Preserve the established summary projection, evaluated only for selected IDs.
  const rows = pageIds.length ? await postgresClient.unsafe<Row[]>(
      `SELECT o.id,o.type,o.operation_date "operationDate",o.daily_sequence "dailySequence",o.operation_time "operationTime",o.case_name "caseName",o.doctor_id "doctorId",o.hospital_id "hospitalId",o.side,o.anesthesia_type "anesthesiaType",o.session_count "sessionCount",o.reference_number "referenceNumber",o.operational_amount_received "operationalAmountReceived",d.name "doctorName",h.name "hospitalName",a.name "anesthesiologistName",t.name "technicianName",ce.name "contractEntityName",u.display_name "employeeName",coalesce(fr.status,'awaiting_review') "reviewStatus",coalesce(fr.main_amount,0) "mainAmount",coalesce(fr.main_amount,0)+coalesce((select sum(case when i.kind='financial' and i.financial_effect='add' and i.case_line_state='included' then coalesce(i.effective_amount,i.amount) when i.kind='financial' and i.financial_effect='subtract' and i.case_line_state='included' then -coalesce(i.effective_amount,i.amount) else 0 end) from operation_financial_items i where i.review_id=fr.id),0) "doctorAccountAmount",coalesce((select sum(case when i.kind='financial' and i.case_line_state='included' then case when i.financial_effect='add' then coalesce(i.effective_amount,i.amount) when i.financial_effect='subtract' then -coalesce(i.effective_amount,i.amount) else 0 end else 0 end) from operation_financial_items i where i.review_id=fr.id),0) "totalItems",coalesce((select sum(case when i.kind='financial' and i.financial_effect='add' and i.case_line_state='included' then coalesce(i.effective_amount,i.amount) else 0 end) from operation_financial_items i where i.review_id=fr.id),0) "additionTotal",coalesce((select sum(case when i.kind='financial' and i.financial_effect='subtract' and i.case_line_state='included' then coalesce(i.effective_amount,i.amount) else 0 end) from operation_financial_items i where i.review_id=fr.id),0) "deductionTotal",coalesce((select jsonb_object_agg(i.definition_id::text,coalesce(i.effective_amount,i.amount)) from operation_financial_items i where i.review_id=fr.id and i.definition_id is not null),'{}'::jsonb) "definitionValues",coalesce((select sum(p.amount) from operation_financial_payments p where p.review_id=fr.id),0) paid,exists(select 1 from doctor_account_postings dp where dp.operation_id=o.id and not dp.reversed) posted,coalesce((select string_agg(p.name,'، ' order by p.name) from operation_procedures op join procedures p on p.id=op.procedure_id where op.operation_id=o.id),'') procedures,coalesce((select string_agg(e.name,'، ' order by e.name) from operation_equipment oe join equipment e on e.id=oe.equipment_id where oe.operation_id=o.id),'') equipment,coalesce((select string_agg(c.name,'، ' order by c.name) from operation_consumables oc join consumables c on c.id=oc.consumable_id where oc.operation_id=o.id),'') consumables,coalesce((select string_agg(s.name,'، ' order by os.sort_order,s.name) from operation_stents os join stents s on s.id=os.stent_id where os.operation_id=o.id),'') stents FROM operations o left join operation_financial_reviews fr on fr.operation_id=o.id left join doctors d on d.id=o.doctor_id left join hospitals h on h.id=o.hospital_id left join anesthesiologists a on a.id=o.anesthesiologist_id left join technicians t on t.id=o.technician_id left join contract_entities ce on ce.id=o.contract_entity_id join users u on u.id=o.created_by_user_id WHERE o.id=any($1::uuid[]) AND o.status='recorded' ORDER BY o.operation_date desc,o.daily_sequence desc,o.id desc`,
    [pageIds.map(row => row.id)],
  ) : [];
  const operationIds = rows.map((row) => String(row.id));
  const directReviews = rows.length
    ? await postgresClient.unsafe<Array<{ operationId: string; due: string; received: string | null }>>(
        `select operation_id "operationId",doctor_account_amount due,doctor_received_amount received from operation_financial_reviews where accounting_mode='direct_items' and operation_id=any($1::uuid[])`,
        [operationIds],
      )
    : [];
  const directByOperation = new Map(directReviews.map((review) => [review.operationId, review]));
  return {
    operations: rows.map((row) => {
      const direct = directByOperation.get(String(row.id));
      const doctorAccountAmount = direct ? money(direct.due) : money(row.doctorAccountAmount);
      const paid = direct ? money(direct.received) : money(row.paid);
      return {
      ...row,
      mainAmount: money(row.mainAmount),
      doctorAccountAmount,
      totalItems: money(row.totalItems),
      additionTotal: money(row.additionTotal),
      deductionTotal: money(row.deductionTotal),
      definitionValues: (row.definitionValues ?? {}) as Record<string, number>,
      totalCosts: money(row.deductionTotal),
      finalBalance: direct
        ? Math.max(0, doctorAccountAmount - paid)
        : money(row.mainAmount) + money(row.additionTotal) - money(row.deductionTotal),
      paid,
      remaining: Math.max(0, doctorAccountAmount - paid),
    };
    }),
    pagination: operationPaginationMetadata(total, resolved),
    filters: { period: resolved.period, year: resolved.period === "month" ? Number(resolved.from!.slice(0, 4)) : null, month: resolved.period === "month" ? Number(resolved.from!.slice(5, 7)) : null, from: resolved.from, to: resolved.to },
    limit: resolved.pageSize,
    offset: resolved.offset,
  };
}

export async function getFinancialReviewOperation(
  operationId: string,
  user: AuthUser,
  db: Executor = postgresClient,
) {
  if (
    !user.permissions.includes("accounting.finance.view") &&
    !user.permissions.includes("accounting.review")
  )
    throw new OperationDomainError(
      403,
      "FINANCIAL_ACCESS_DENIED",
      "لا تملك صلاحية عرض المراجعة المالية.",
    );
  const [operation] = await db.unsafe<Row[]>(
    `SELECT o.*,ls.name lithotripsy_session_name,d.name doctor_name,h.name hospital_name,a.name anesthesiologist_name,t.name technician_name,ce.name contract_entity_name,u.display_name employee_name FROM operations o left join lithotripsy_sessions ls on ls.id=o.lithotripsy_session_id left join doctors d on d.id=o.doctor_id left join hospitals h on h.id=o.hospital_id left join anesthesiologists a on a.id=o.anesthesiologist_id left join technicians t on t.id=o.technician_id left join contract_entities ce on ce.id=o.contract_entity_id join users u on u.id=o.created_by_user_id where o.id=$1::uuid and o.status='recorded'`,
    [operationId],
  );
  if (!operation)
    throw new OperationDomainError(
      404,
      "OPERATION_NOT_FOUND",
      "العملية غير موجودة أو غير متاحة.",
    );
  if (!operation.form_template_id)
    throw new OperationDomainError(
      409,
      "HISTORICAL_TEMPLATE_REQUIRED",
      "لا يمكن مراجعة سجل قديم بلا إصدار نموذج.",
    );
  const templateId = String(operation.form_template_id);
  const [template] = await db.unsafe<Row[]>(
    "select id,name,version,operation_type from work_form_templates where id=$1::uuid",
    [templateId],
  );
  if (!template)
    throw new OperationDomainError(
      409,
      "HISTORICAL_TEMPLATE_MISSING",
      "تعريف النموذج التاريخي غير متاح.",
    );
  const fields = await db.unsafe<Row[]>(
    "select id,stable_key,label,field_type,smart_dropdown_source,is_financial,financial_effect,review_role,sort_order,section_id from work_form_fields where template_id=$1::uuid and archived_at is null and (review_role <> 'hidden' or is_financial=true or stable_key in ('anesthesiologist','technician','equipment','consumables','stents')) order by section_id,sort_order",
    [templateId],
  );
  const procedures = await db.unsafe<Row[]>(
      "select p.id,p.name from operation_procedures x join procedures p on p.id=x.procedure_id where x.operation_id=$1::uuid order by p.name",
      [operationId],
    ),
    equipment = await db.unsafe<Row[]>(
      "select e.id,e.name from operation_equipment x join equipment e on e.id=x.equipment_id where x.operation_id=$1::uuid order by e.name",
      [operationId],
    ),
    consumables = await db.unsafe<Row[]>(
      "select c.id,c.name from operation_consumables x join consumables c on c.id=x.consumable_id where x.operation_id=$1::uuid order by c.name",
      [operationId],
    ),
    stents = await db.unsafe<Row[]>(
      "select s.id,s.name from operation_stents x join stents s on s.id=x.stent_id where x.operation_id=$1::uuid order by x.sort_order,s.name",
      [operationId],
    ),
    scalar = await db.unsafe<Row[]>(
      "select * from operation_field_values where operation_id=$1::uuid",
      [operationId],
    ),
    multi = await db.unsafe<Row[]>(
      "select field_id,reference_id,sort_order from operation_field_reference_values where operation_id=$1::uuid order by field_id,sort_order",
      [operationId],
    );
  const scalarMap = new Map(scalar.map((row) => [String(row.field_id), row])),
    multiMap = new Map<string, string[]>();
  for (const row of multi) {
    const key = String(row.field_id),
      values = multiMap.get(key) ?? [];
    values.push(String(row.reference_id));
    multiMap.set(key, values);
  }
  const context: Array<{
      fieldId: string;
      stableKey: string;
      label: string;
      display: string | string[];
      isFinancial: boolean;
      financialEffect: string | null;
      operationalValue: string | null;
    }> = [],
    suggestions: Array<Record<string, unknown>> = [];
  for (const field of fields) {
    const id = String(field.id),
      key = String(field.stable_key),
      reviewRole = String(field.review_role ?? "hidden") === "hidden" && ["anesthesiologist", "technician", "equipment", "consumables", "stents"].includes(key) ? "cost_source" : String(field.review_role ?? "hidden"),
      source = field.smart_dropdown_source
        ? String(field.smart_dropdown_source)
        : null;
    let display: string | string[] = "",
      refs: string[] = [],
      operationalValue: string | null = null;
    if (key === "procedures") {
      display = procedures.map((row) => String(row.name));
      refs = procedures.map((row) => String(row.id));
    } else if (key === "equipment") {
      display = equipment.map((row) => String(row.name));
      refs = equipment.map((row) => String(row.id));
    } else if (key === "consumables") {
      display = consumables.map((row) => String(row.name));
      refs = consumables.map((row) => String(row.id));
    } else if (key === "stents") {
      display = stents.map((row) => String(row.name));
      refs = stents.map((row) => String(row.id));
    } else if (key === "session_count" && operation.lithotripsy_session_name) {
      display = String(operation.lithotripsy_session_name);
    } else {
      const core = coreValue(operation, key);
      if (core != null) {
        display = String(core);
        if (coreReference[key] && operation[coreReference[key]]) refs = [String(operation[coreReference[key]])];
      }
      else {
        const stored = scalarMap.get(id);
        if (stored) {
          const value =
            stored.reference_id ??
            stored.text_value ??
            stored.number_value ??
            stored.money_value ??
            stored.date_value ??
            stored.time_value ??
            stored.boolean_value;
          if (stored.reference_id && source) {
            refs = [String(stored.reference_id)];
            display = await refLabel(db, source, refs[0]);
          } else {
            display =
              stored.boolean_value != null
                ? stored.boolean_value
                  ? "نعم"
                  : "لا"
                : String(value ?? "");
            if (field.field_type === "money")
              operationalValue = String(stored.money_value);
          }
        } else if (source && multiMap.has(id)) {
          refs = multiMap.get(id)!;
          display = await Promise.all(
            refs.map((ref) => refLabel(db, source, ref)),
          );
        }
      }
    }
    if (
      (Array.isArray(display) && display.length) ||
      (!Array.isArray(display) && display)
    ) {
      context.push({
        fieldId: id,
        stableKey: key,
        label: String(field.label || labels[key] || key),
        display,
        isFinancial: Boolean(field.is_financial),
        financialEffect: field.financial_effect
          ? String(field.financial_effect)
          : null,
        operationalValue,
      });
      const shouldSuggest = reviewRole === "cost_source" || Boolean(field.is_financial);
      if (shouldSuggest) {
        const displays = Array.isArray(display) ? display : [display],
          identities = refs.length ? refs : [null];
        for (let index = 0; index < displays.length; index++)
          suggestions.push({
            sourceType: key === "consumables" ? "consumable" : key === "procedures" ? "procedure" : key === "equipment" ? "equipment" : key === "stents" ? "stent" : "dynamic_field",
            sourceFieldId: id,
            sourceReferenceId: identities[index],
            description:
              displays.length > 1
                ? String(displays[index])
                : String(field.label) +
                  (String(displays[index]) ? `: ${displays[index]}` : ""),
            financialEffect: field.financial_effect ?? "subtract",
            operationalValue,
          });
      }
    }
  }
  const [review] = await db.unsafe<Row[]>(
      "select * from operation_financial_reviews where operation_id=$1::uuid",
      [operationId],
    ),
    items = review
      ? await db.unsafe<Row[]>(
          `select i.*,ppl.line_type pricing_profile_line_type
             from operation_financial_items i
             left join lithotripsy_pricing_profile_lines ppl on ppl.id=i.pricing_profile_line_id
            where i.review_id=$1::uuid order by i.created_at,i.id`,
          [String(review.id)],
        )
      : [],
    payments = review
      ? await db.unsafe<Row[]>(
          "select * from operation_financial_payments where review_id=$1::uuid order by paid_at,id",
          [String(review.id)],
        )
      : [],
    postedRows = await db.unsafe<Row[]>(
      "select id,amount,direction,posted_at from doctor_account_postings where operation_id=$1::uuid and reversed=false",
      [operationId],
    );
  const sourceContract = await getOperationFinancialSources(operationId, db);
  const savedProfile = review
    ? (await db.unsafe<Row[]>(
        `select p.id,p.name,p.session_number,p.session_id,s.name session_name,max(i.pricing_profile_version) version
           from operation_financial_items i
           join lithotripsy_pricing_profiles p on p.id=i.pricing_profile_id
           left join lithotripsy_sessions s on s.id=p.session_id
          where i.review_id=$1::uuid
          group by p.id,p.name,p.session_number,p.session_id,s.name
          order by count(*) desc,p.id
          limit 1`,
        [String(review.id)],
      ))[0] ?? null
    : null;
  const savedServiceProfile = review && operation.type !== "lithotripsy"
    ? (await db.unsafe<Row[]>(`select p.id,p.name,max(i.service_pricing_version) version,p.hospital_id "hospitalId" from operation_financial_items i join service_pricing_profiles p on p.id=i.service_pricing_profile_id where i.review_id=$1::uuid group by p.id,p.name,p.hospital_id order by count(*) desc limit 1`, [String(review.id)]))[0] ?? null
    : null;
  // A saved review is an immutable financial snapshot. Only unreviewed cases
  // resolve today's active pricing configuration.
  const lithotripsyPricingDefaults: LithotripsyResolvedPrices | null = operation.type === "lithotripsy" && !review
    ? await resolveLithotripsyReviewDefaults(operationId, db)
    : null;
  const servicePricing = operation.type !== "lithotripsy" && !review ? await resolveServicePricing(operationId, db) : null;
  const pricingDefaults = lithotripsyPricingDefaults ?? servicePricing?.prices.map((price) => ({
    source: price.source,
    definitionId: "",
    stableKey: price.servicePricingItemId ?? `${price.source?.sourceType ?? "fixed"}_unpriced`,
    label: price.label,
    defaultAmount: price.defaultAmount,
    effect: price.effect,
    pricingOrigin: price.pricingOrigin,
    servicePricingProfileId: price.servicePricingProfileId || null,
    servicePricingItemId: price.servicePricingItemId,
    servicePricingVersion: price.servicePricingVersion || null,
  })) ?? null;
  const hydratedFinancialItems = lithotripsyPricingDefaults ? hydrateNewLithotripsyFinancialDraft(lithotripsyPricingDefaults) : [];
  const persisted = new Set(
    items
      .filter((row) => !["manual", "other"].includes(String(row.source_type)))
      .map((row) =>
        [
          row.source_type,
          row.source_field_id ?? "",
          row.source_reference_id ?? "",
        ].join(":"),
      ),
  );
  const persistedFieldRefs = new Set(
    items
      .filter((row) => !["manual", "other"].includes(String(row.source_type)))
      .map((row) => `${row.source_field_id ?? ""}:${row.source_reference_id ?? ""}`),
  );
  const currentSourceKeys = new Set(
    sourceContract.costSources.map((source) => `${source.sourceType}:${source.sourceFieldId ?? ""}:${source.sourceReferenceId ?? ""}`),
  );
  const orphanedItems = items.filter((row) => !["manual", "other"].includes(String(row.source_type)) && !currentSourceKeys.has(`${row.source_type}:${row.source_field_id ?? ""}:${row.source_reference_id ?? ""}`)).map((row) => ({ id: row.id, description: row.description, amount: row.amount == null ? null : String(row.amount), sourceType: row.source_type, sourceFieldId: row.source_field_id, sourceReferenceId: row.source_reference_id }));
  return {
    operation: {
      id: operation.id,
      type: operation.type,
      dailySequence: operation.daily_sequence,
      operationDate: operation.operation_date,
      operationTime: operation.operation_time,
      caseName: operation.case_name,
      doctorId: operation.doctor_id,
      doctorName: operation.doctor_name,
      hospitalName: operation.hospital_name,
      contractEntityName: operation.contract_entity_name,
      employeeName: operation.employee_name,
    },
    template: {
      id: template.id,
      name: template.name,
      version: template.version,
    },
    context,
    operationContext: context,
    operationalCostSources: sourceContract.costSources,
    pricingDefaults,
    hydratedFinancialItems,
    pricingProfile: operation.type !== "lithotripsy" ? null : lithotripsyPricingDefaults ? {
        id: lithotripsyPricingDefaults.profileId ?? null,
        name: lithotripsyPricingDefaults.profileName ?? null,
        version: lithotripsyPricingDefaults.profileVersion ?? null,
        matchType: lithotripsyPricingDefaults.profileMatchType ?? null,
        sessionNumber: lithotripsyPricingDefaults.sessionNumber ?? Number(operation.session_count),
        sessionId: lithotripsyPricingDefaults.sessionId,
        sessionName: lithotripsyPricingDefaults.sessionName,
        procedureIds: lithotripsyPricingDefaults.procedureIds ?? [],
        procedureSetKey: lithotripsyPricingDefaults.procedureSetKey ?? "",
        warningCode: lithotripsyPricingDefaults.warningCode ?? null,
        warningMessage: lithotripsyPricingDefaults.warningMessage ?? null,
      } : savedProfile ? {
        id: savedProfile.id,
        name: savedProfile.name,
        version: savedProfile.version,
        matchType: "snapshot",
        sessionNumber: savedProfile.session_number ?? Number(operation.session_count),
        sessionId: savedProfile.session_id ?? null,
        sessionName: savedProfile.session_name ?? null,
        procedureIds: [],
        procedureSetKey: "",
        warningCode: null,
        warningMessage: null,
      } : null,
    servicePricingProfile: servicePricing?.profile
      ? { ...servicePricing.profile, warning: servicePricing.warning }
      : savedServiceProfile
        ? { id: savedServiceProfile.id, name: savedServiceProfile.name, version: savedServiceProfile.version, hospitalId: savedServiceProfile.hospitalId, warning: null, matchType: "snapshot" }
        : { id: null, name: null, version: null, hospitalId: operation.hospital_id ?? null, warning: servicePricing?.warning ?? null },
    orphanedItems,
    posting: postedRows[0] ? {
      id: String(postedRows[0].id),
      amount: money(postedRows[0].amount),
      direction: String(postedRows[0].direction ?? "debit") as "debit" | "credit",
      signedAmount: String(postedRows[0].direction ?? "debit") === "credit" ? -money(postedRows[0].amount) : money(postedRows[0].amount),
      postedAt: new Date(String(postedRows[0].posted_at)).toISOString(),
    } : null,
    accountantFinancialItems: items,
    financialSummary: {
      mainAmount: money(review?.main_amount),
      additionTotal: signedItemTotal(items.map((row) => ({ kind: String(row.kind), financialEffect: String(row.financial_effect) === "add" ? "add" : "neutral", amount: row.amount, effectiveAmount: row.effective_amount, caseLineState: String(row.case_line_state ?? "included") }))),
      deductionTotal: Math.abs(signedItemTotal(items.map((row) => ({ kind: String(row.kind), financialEffect: String(row.financial_effect) === "subtract" ? "subtract" : "neutral", amount: row.amount, effectiveAmount: row.effective_amount, caseLineState: String(row.case_line_state ?? "included") })))),
      finalBalance: String(review?.accounting_mode ?? "main_amount") === "direct_items" ? money(review?.doctor_account_amount) : money(review?.main_amount) + signedItemTotal(items.map((row) => ({ kind: String(row.kind), financialEffect: String(row.financial_effect), amount: row.amount, effectiveAmount: row.effective_amount, caseLineState: String(row.case_line_state ?? "included") }))),
    },
    suggestions: suggestions.filter(
      (item) =>
        !sourceContract.costSources.some(
          (source) =>
            (source.sourceFieldId ?? "") === (item.sourceFieldId ?? "") &&
            (source.sourceReferenceId ?? "") === (item.sourceReferenceId ?? ""),
        ) &&
        !persisted.has(
          [
            item.sourceType,
            item.sourceFieldId ?? "",
            item.sourceReferenceId ?? "",
          ].join(":"),
        ) && !persistedFieldRefs.has(`${item.sourceFieldId ?? ""}:${item.sourceReferenceId ?? ""}`),
    ),
    review: reviewSummary(
      review ? { ...review, doctor_account_amount: String(review.accounting_mode ?? "main_amount") === "direct_items" ? money(review.doctor_account_amount) : money(review.main_amount) + signedItemTotal(items.map((row) => ({ kind: String(row.kind), financialEffect: String(row.financial_effect), amount: row.amount, effectiveAmount: row.effective_amount, caseLineState: String(row.case_line_state ?? "included") }))) } : null,
      items,
      payments,
      postedRows.length > 0,
    ),
  };
}

export async function saveFinancialReviewInTransaction(
  tx: TxExecutor,
  operationId: string,
  input: FinancialReviewInput,
  user: AuthUser,
) {
  const [operation] = await tx.unsafe<Row[]>(
    "select id,status,type from operations where id=$1::uuid for update",
    [operationId],
  );
  if (!operation || operation.status !== "recorded")
    throw new OperationDomainError(
      409,
      "OPERATION_NOT_REVIEWABLE",
      "العملية غير متاحة للمراجعة.",
    );
  const [activePosting] = await tx.unsafe<Row[]>(
    "select id from doctor_account_postings where operation_id=$1::uuid and reversed=false limit 1",
    [operationId],
  );
  if (activePosting)
    throw new OperationDomainError(
      409,
      "POSTED_FINANCIAL_REVIEW_IMMUTABLE",
      "لا يمكن تعديل القيم المالية بعد ترحيل الحالة إلى حساب الطبيب.",
    );
  const [existing] = await tx.unsafe<Row[]>(
    "select id,updated_at from operation_financial_reviews where operation_id=$1::uuid for update",
    [operationId],
  );
  if (existing) {
    if (
      !input.expectedUpdatedAt ||
      new Date(String(existing.updated_at)).toISOString() !==
        input.expectedUpdatedAt
    )
      throw new OperationDomainError(
        409,
        "STALE_FINANCIAL_REVIEW",
        "تم تحديث المراجعة من نافذة أخرى. أعد تحميل البيانات.",
      );
  } else if (input.expectedUpdatedAt)
    throw new OperationDomainError(
      409,
      "STALE_FINANCIAL_REVIEW",
      "نسخة المراجعة غير متطابقة.",
    );
  const accountingMode = operation.type === "lithotripsy" ? input.accountingMode : "direct_items";
    const projection = await getFinancialReviewOperation(
      operationId,
      {
        id: user.id,
        permissions: [...user.permissions, "accounting.review"],
      },
      tx,
    ),
    allowedSources = new Set(
      [
        ...projection.operationalCostSources,
        ...projection.suggestions,
        ...projection.review.items,
      ]
        .filter(
          (item) => !["manual", "other"].includes(String(item.sourceType)),
        )
        .map((item) =>
          [
            String(item.sourceType),
            String(item.sourceFieldId ?? ""),
            String(item.sourceReferenceId ?? ""),
          ].join(":"),
        ),
    );
  const identities = new Set<string>();
  for (const item of input.items) {
    if (!["manual", "other"].includes(item.sourceType)) {
      const identity = [
        item.sourceType,
        item.sourceFieldId ?? "",
        item.sourceReferenceId ?? "",
      ].join(":");
      if (!allowedSources.has(identity))
        throw new OperationDomainError(
          400,
          "INVALID_FINANCIAL_SOURCE",
          "مصدر البند المالي لا ينتمي إلى بيانات العملية.",
        );
      if (identities.has(identity))
        throw new OperationDomainError(
          400,
          "DUPLICATE_FINANCIAL_SOURCE",
          "تم تكرار نفس البند التشغيلي.",
        );
      identities.add(identity);
    }
  }
  const [review] = await tx.unsafe<Row[]>(
    `insert into operation_financial_reviews(operation_id,status,accounting_mode,main_amount,doctor_account_amount,doctor_received_amount,doctor_balance_received,notes,reviewed_by_user_id) values($1::uuid,'reviewed',$2::financial_review_accounting_mode,$3::numeric,0,$4::numeric,$5::boolean,$6,$7::uuid) on conflict(operation_id) do update set accounting_mode=excluded.accounting_mode,main_amount=excluded.main_amount,doctor_received_amount=excluded.doctor_received_amount,doctor_balance_received=excluded.doctor_balance_received,notes=excluded.notes,reviewed_by_user_id=excluded.reviewed_by_user_id,updated_at=clock_timestamp() returning id,updated_at`,
    [
      operationId,
      accountingMode,
      accountingMode === "direct_items" ? "0.00" : input.mainAmount ?? "0.00",
      operation.type !== "contract" && accountingMode === "direct_items" ? input.doctorReceivedAmount ?? null : null,
      input.doctorBalanceReceived ?? false,
      input.notes ?? null,
      user.id,
    ],
  );
  await tx.unsafe(
    "delete from operation_financial_items where review_id=$1::uuid",
    [String(review.id)],
  );
  for (const item of input.items) {
    const base = item.baseAmount == null ? null : Number(item.baseAmount);
    const adjustment = item.adjustmentAmount == null ? null : Number(item.adjustmentAmount);
    const requested = item.effectiveAmount ?? item.amount ?? null;
    const calculatedEffective = item.kind === "note"
      ? 0
      : base != null
        ? base + (adjustment ?? 0)
        : requested == null ? null : Number(requested);
    if (calculatedEffective != null && calculatedEffective < 0)
      throw new OperationDomainError(400, "NEGATIVE_EFFECTIVE_AMOUNT", "لا يمكن أن تصبح قيمة البند أقل من صفر.");
    await tx.unsafe(
      `insert into operation_financial_items(review_id,catalog_item_id,definition_id,kind,description,amount,base_amount,adjustment_amount,effective_amount,case_line_state,pricing_profile_id,pricing_profile_line_id,pricing_profile_version,service_pricing_profile_id,service_pricing_item_id,service_pricing_version,financial_effect,source_type,source_field_id,source_reference_id,notes,created_by_user_id) values($1::uuid,$2::uuid,$3::uuid,$4::operation_financial_item_kind,$5,$6::numeric,$7::numeric,$8::numeric,$9::numeric,$10::operation_financial_line_state,$11::uuid,$12::uuid,$13,$14::uuid,$15::uuid,$16,$17::work_form_financial_effect,$18::financial_item_source_type,$19::uuid,$20::uuid,$21,$22::uuid)`,
      [
        String(review.id),
        item.catalogItemId ?? null,
        item.definitionId ?? null,
        item.kind,
        item.description,
        item.amount ?? null,
        item.baseAmount ?? null,
        item.adjustmentAmount ?? null,
        calculatedEffective == null ? null : calculatedEffective.toFixed(2),
        item.caseLineState ?? "included",
        item.pricingProfileId ?? null,
        item.pricingProfileLineId ?? null,
        item.pricingProfileVersion ?? null,
        item.servicePricingProfileId ?? null,
        item.servicePricingItemId ?? null,
        item.servicePricingVersion ?? null,
        item.financialEffect,
        item.sourceType,
        item.sourceFieldId ?? null,
        item.sourceReferenceId ?? null,
        item.notes ?? null,
        user.id,
      ],
    );
  }
  const [calculated] = accountingMode === "direct_items"
    ? await tx.unsafe<Row[]>(`select coalesce(sum(case when kind='financial' and financial_effect<>'neutral' and case_line_state='included' then coalesce(effective_amount,amount) else 0 end),0) balance from operation_financial_items where review_id=$1::uuid`, [String(review.id)])
    : await tx.unsafe<Row[]>(
    `select ($2::numeric
      + coalesce(sum(case when kind='financial' and financial_effect='add' and case_line_state='included' then coalesce(effective_amount,amount) else 0 end),0)
      - coalesce(sum(case when kind='financial' and financial_effect='subtract' and case_line_state='included' then coalesce(effective_amount,amount) else 0 end),0)) balance
       from operation_financial_items where review_id=$1::uuid`,
    [String(review.id), input.mainAmount ?? "0.00"],
  );
  const due = money(calculated.balance);
  await tx.unsafe(
    "update operation_financial_reviews set doctor_account_amount=$2::numeric where id=$1::uuid",
    [String(review.id), String(calculated.balance)],
  );
  const [paidRow] = await tx.unsafe<Row[]>(
      "select coalesce(sum(amount),0) paid from operation_financial_payments where review_id=$1::uuid",
      [String(review.id)],
    ),
    paid = money(paidRow.paid),
    received = operation.type !== "contract" && accountingMode === "direct_items" ? (input.doctorReceivedAmount == null ? 0 : money(input.doctorReceivedAmount)) : paid,
    payment = calculateDirectPaymentSummary(due, operation.type !== "contract" && accountingMode === "direct_items" && input.doctorReceivedAmount == null ? null : received),
    status = operation.type === "contract" ? "reviewed" : payment.state === "paid" ? "paid" : payment.state === "partial" ? "partially_paid" : "reviewed";
  await tx.unsafe(
    "update operation_financial_reviews set status=$2::financial_review_status where id=$1::uuid",
    [String(review.id), status],
  );
  return {
    id: review.id,
    updatedAt: new Date(String(review.updated_at)).toISOString(),
    totalItems: signedItemTotal(input.items),
  };
}
export async function saveFinancialReview(
  operationId: string,
  input: FinancialReviewInput,
  user: AuthUser,
) {
  return postgresClient.begin((tx) =>
    saveFinancialReviewInTransaction(tx, operationId, input, user),
  );
}
