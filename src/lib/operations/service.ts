import { invoicePredicate, invoiceOrder } from "./tax-invoice";
import { postgresClient } from "@/db/client";
import { operationPaginationMetadata, resolveOperationPagination, type OperationFilters } from "./validation";
import { OperationDomainError } from "./api";

type AuthUser = { id: string; role: { code: string }; permissions: string[] };
type Row = Record<string, unknown>;
const employee = (user: AuthUser) => user.role.code === "employee";
const money = (value: unknown) => Number(value ?? 0);

export async function listOperations(
  filters: OperationFilters,
  user: AuthUser,
) {
  const resolved = resolveOperationPagination(filters);
  const conditions = ["o.status <> 'cancelled'"];
  const params: Array<string | number | boolean> = [];
  const add = (sql: string, value: string | number | boolean) => {
    params.push(value);
    conditions.push(sql.replace("?", `$${params.length}`));
  };
  if (resolved.from && resolved.toExclusive) {
    add("o.operation_date >= ?::date", resolved.from);
    add("o.operation_date < ?::date", resolved.toExclusive);
  }
  if (employee(user)) {
    add("o.created_by_user_id = ?::uuid", user.id);
    conditions.push("o.operation_date >= (current_date - 6)");
  }
  if (filters.type) add("o.type = ?::operation_type", filters.type);
  if (filters.doctorId) add("o.doctor_id = ?::uuid", filters.doctorId);
  if (filters.hospitalId) add("o.hospital_id = ?::uuid", filters.hospitalId);
  if (filters.search) {
    params.push(filters.search);
    conditions.push(
      `(o.case_name ILIKE '%' || $${params.length} || '%'
        OR coalesce(o.reference_number, '') ILIKE '%' || $${params.length} || '%'
        OR coalesce(d.name, '') ILIKE '%' || $${params.length} || '%'
        OR coalesce(h.name, '') ILIKE '%' || $${params.length} || '%'
        OR coalesce(ce.name, '') ILIKE '%' || $${params.length} || '%')`,
    );
  }
  conditions.push(invoicePredicate(filters.invoiceStatus));
  const fromSql = `FROM operations o LEFT JOIN operation_tax_invoices ti ON ti.operation_id=o.id LEFT JOIN doctors d ON d.id=o.doctor_id LEFT JOIN hospitals h ON h.id=o.hospital_id LEFT JOIN contract_entities ce ON ce.id=o.contract_entity_id LEFT JOIN users u ON u.id=o.created_by_user_id WHERE ${conditions.join(" AND ")}`;
  const [countRow] = await postgresClient.unsafe<Array<{ total: string }>>(
    `SELECT count(*)::text total ${fromSql}`,
    params,
  );
  const total = Number(countRow?.total ?? 0);
  const rowParams = resolved.pageSize === "all" ? [...params, user.id] : [...params, resolved.pageSize, resolved.offset, user.id];
  const pagingSql = resolved.pageSize === "all" ? "" : `LIMIT $${rowParams.length - 2} OFFSET $${rowParams.length - 1}`;
  const rows = await postgresClient.unsafe<Row[]>(
    `
    SELECT CASE WHEN ti.id IS NULL THEN NULL ELSE json_build_object('id',ti.id,'registry',ti.tax_registry,'registryLabel',CASE ti.tax_registry WHEN 'alnoor' THEN 'النور' ELSE 'الكوثر' END,'invoiceNumber',ti.invoice_number,'createdAt',ti.created_at) END AS "taxInvoice", o.id, o.type, o.status, o.operation_date AS "operationDate", o.daily_sequence AS "dailySequence",
           o.operation_time AS "operationTime", o.case_name AS "caseName", o.created_at AS "createdAt",
           o.doctor_id AS "doctorId", d.name AS "doctorName",
           o.hospital_id AS "hospitalId", h.name AS "hospitalName",
           o.contract_entity_id AS "contractEntityId", ce.name AS "contractEntityName",
           o.reference_number AS "referenceNumber", o.side, o.session_count AS "sessionCount",
           (o.notes is not null and btrim(o.notes) <> '') AS "hasNotes",
           coalesce((select array_agg(p.name order by p.name) from operation_procedures op join procedures p on p.id=op.procedure_id where op.operation_id=o.id),'{}') AS procedures,
           coalesce((select array_agg(e.name order by e.name) from operation_equipment oe join equipment e on e.id=oe.equipment_id where oe.operation_id=o.id),'{}') AS equipment,
           coalesce(u.display_name,u.username) AS "createdByName",
           (o.created_by_user_id = $${rowParams.length}::uuid AND o.created_at >= now() - interval '48 hours') AS "employeeEditWindow"
      ${fromSql}
     ORDER BY ${invoiceOrder(filters.invoiceStatus)}
     ${pagingSql}`,
    rowParams,
  );
  return {
    operations: rows,
    pagination: operationPaginationMetadata(total, resolved),
    filters: { period: resolved.period, from: resolved.from, to: resolved.to },
    // Retained for callers that still read the legacy response fields.
    limit: resolved.pageSize,
    offset: resolved.offset,
  };
}

export async function addPayment(
  id: string,
  amount: number,
  notes: string | null,
  user: AuthUser,
) {
  return postgresClient.begin(async (tx) => {
    const [r] = await tx.unsafe<Row[]>(
      `SELECT fr.id,fr.doctor_account_amount,o.type,
              exists(
                select 1 from doctor_account_postings dap
                where dap.operation_id=o.id and dap.reversed=false
              ) doctor_account_posted
         FROM operation_financial_reviews fr
         join operations o on o.id=fr.operation_id
        WHERE fr.operation_id=$1::uuid
        FOR UPDATE OF fr,o`,
      [id],
    );
    if (!r)
      throw new OperationDomainError(
        409,
        "REVIEW_REQUIRED",
        "يجب حفظ المراجعة المالية أولاً.",
      );
    if (r.type === "contract") throw new OperationDomainError(409, "CONTRACT_DOCTOR_PAYMENT_FORBIDDEN", "حالات التعاقد تُحصّل من جهة التعاقد وليست من حساب الطبيب.");
    if (r.doctor_account_posted)
      throw new OperationDomainError(
        409,
        "OPERATION_PAYMENT_AFTER_POSTING_FORBIDDEN",
        "بعد ترحيل الحالة، تُسجّل أي دفعة في حساب الطبيب وليس على العملية.",
      );
    const reviewId = String(r.id);
    const [sum] = await tx.unsafe<Row[]>(
      "SELECT coalesce(sum(amount),0) paid FROM operation_financial_payments WHERE review_id=$1::uuid",
      [reviewId],
    );
    await tx.unsafe(
      "INSERT INTO operation_financial_payments(review_id,amount,notes,created_by_user_id) VALUES($1::uuid,$2,$3,$4::uuid)",
      [reviewId, amount, notes, user.id],
    );
    const total = money(sum.paid) + amount;
    await tx.unsafe(
      "UPDATE operation_financial_reviews SET status=$2::financial_review_status,updated_at=now() WHERE id=$1::uuid",
      [
        reviewId,
        total >= money(r.doctor_account_amount) ? "paid" : "partially_paid",
      ],
    );
  });
}

export async function postDoctorAccount(id: string, user: AuthUser) {
  try {
    const [row] = await postgresClient.unsafe<Row[]>(
      `WITH candidate AS (
         SELECT o.id operation_id,fr.id review_id,o.doctor_id,
                o.case_name,o.type,d.name doctor_name,
                fr.doctor_account_amount-
                  case when fr.accounting_mode='direct_items'
                    then coalesce(fr.doctor_received_amount,0)
                    else coalesce((
                      select sum(p.amount) from operation_financial_payments p where p.review_id=fr.id
                    ),0) end settlement_balance,
                case when fr.accounting_mode='direct_items'
                  then coalesce((
                    select sum(
                      case when i.kind='financial'
                                and i.case_line_state='included'
                                and i.financial_effect in ('add','subtract')
                        then coalesce(i.base_amount,i.effective_amount,i.amount,0)
                        else 0 end
                    )
                    from operation_financial_items i where i.review_id=fr.id
                  ),0)
                  else fr.main_amount
                end reference_amount
           FROM operations o
           JOIN operation_financial_reviews fr ON fr.operation_id=o.id
           JOIN doctors d ON d.id=o.doctor_id
          WHERE o.id=$1::uuid
            AND o.status='recorded'
            AND o.type IN ('lithotripsy','endoscopy')
            AND o.doctor_id IS NOT NULL
            AND fr.status<>'awaiting_review'
            AND fr.doctor_balance_received=false
          FOR UPDATE OF o,fr
       )
       INSERT INTO doctor_account_postings(
         operation_id,review_id,doctor_id,amount,direction,
         case_name_snapshot,operation_type_snapshot,doctor_name_snapshot,
         reference_amount_snapshot,difference_amount_snapshot,posted_by_user_id
       )
       SELECT operation_id,review_id,doctor_id,abs(settlement_balance),
              case when settlement_balance < 0 then 'credit' else 'debit' end,
              case_name,type,doctor_name,reference_amount,
              settlement_balance-reference_amount,$2::uuid
         FROM candidate
        WHERE settlement_balance <> 0
       RETURNING id,amount,direction,
                 case when direction='credit' then -amount else amount end AS "signedAmount",
                 posted_at AS "postedAt"`,
      [id, user.id],
    );
    if (!row) {
      const [state] = await postgresClient.unsafe<Row[]>(
        `select o.type,o.doctor_id,fr.id review_id,fr.status
           from operations o
           left join operation_financial_reviews fr on fr.operation_id=o.id
          where o.id=$1::uuid and o.status='recorded'`,
        [id],
      );
      if (!state) throw new OperationDomainError(404, "OPERATION_NOT_FOUND", "الحالة غير موجودة أو غير متاحة.");
      if (state.type === "contract") throw new OperationDomainError(409, "CONTRACT_DOCTOR_POSTING_FORBIDDEN", "حالات التعاقد لا تُرحّل إلى حساب الطبيب.");
      if (!state.doctor_id) throw new OperationDomainError(409, "POSTING_DOCTOR_REQUIRED", "لا يوجد طبيب مرتبط بالحالة.");
      if (!state.review_id || state.status === "awaiting_review") throw new OperationDomainError(409, "POSTING_REVIEW_REQUIRED", "احفظ المراجعة المالية أولاً قبل الترحيل.");
      throw new OperationDomainError(409, "NO_SETTLEMENT_BALANCE", "لا يوجد رصيد للتسوية والترحيل.");
    }
    return row;
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      throw new OperationDomainError(
        409,
        "ALREADY_POSTED",
        "تم ترحيل العملية مسبقاً.",
      );
    throw error;
  }
}

export async function cancelOperation(
  id: string,
  reason: string,
  user: AuthUser,
) {
  const result = await postgresClient.unsafe<Row[]>(
    `UPDATE operations SET status='cancelled',cancellation_reason=$2,cancelled_by_user_id=$3::uuid,cancelled_at=now(),updated_at=now() WHERE id=$1::uuid AND status<>'cancelled' AND NOT EXISTS(SELECT 1 FROM doctor_account_postings WHERE operation_id=$1::uuid AND reversed=false) RETURNING id`,
    [id, reason, user.id],
  );
  if (!result[0])
    throw new OperationDomainError(
      409,
      "CANCEL_NOT_ALLOWED",
      "لا يمكن إلغاء العملية بعد ترحيلها أو أنها ملغاة بالفعل.",
    );
}
