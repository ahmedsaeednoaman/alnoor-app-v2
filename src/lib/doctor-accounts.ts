import type { TransactionSql } from "postgres";
import { postgresClient } from "@/db/client";
import { OperationDomainError } from "@/lib/operations/api";


type DbRow = Record<string, unknown>;

export type DoctorAccountSummary = {
  doctorId: string;
  doctorName: string;
  specialty: string | null;
  balance: number;
  movementCount: number;
  lastMovementAt: string | null;
};

export type DoctorSupplyItem = {
  id: string;
  sourceType: "consumable" | "stent" | "equipment" | "manual";
  sourceReferenceId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  notes: string | null;
};

export type DoctorAccountMovement = {
  id: string;
  type:
    | "operation_posting"
    | "supply_issue"
    | "payment"
    | "adjustment";

  occurredAt: string;
  description: string;

  amount: number;
  signedAmount: number;
  debitAmount: number;
  creditAmount: number;
  effect: "debit" | "credit";
  businessDate: string;
  balanceBefore: number;
  balanceAfter: number;

  operationId: string | null;
  caseName: string | null;
  operationType: string | null;
  doctorNameSnapshot: string | null;

  /*
   * Operation financial context.
   *
   * operationReferenceAmount:
   * the amount before the final doctor-account posting whenever
   * that value can be resolved safely from the saved review.
   *
   * operationPostedAmount:
   * the exact immutable amount that was posted to the doctor's
   * account.
   */
  operationReferenceAmount: number | null;
  operationPostedAmount: number | null;
  /** Posted amount minus the saved reference amount. */
  operationDifferenceAmount: number | null;

  /*
   * Supply issue details.
   * Empty for non-supply movements.
   */
  supplyItems: DoctorSupplyItem[];

  notes: string | null;
};

export type DoctorAccountLedgerDay = {
  date: string;
  openingBalance: number;
  debitTotal: number;
  creditTotal: number;
  netMovement: number;
  closingBalance: number;
  movements: DoctorAccountMovement[];
};

export type DoctorAccountLedger = {
  timezone: typeof DOCTOR_ACCOUNT_TIMEZONE;
  from: string | null;
  to: string | null;
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  periodNetMovement: number;
  closingBalance: number;
  days: DoctorAccountLedgerDay[];
};

export type DoctorAccountDetails = {
  doctor: {
    id: string;
    name: string;
    specialty: string | null;
  };

  balance: number;
  movementCount: number;
  lastMovementAt: string | null;

  totalDebit: number;
  totalCredit: number;

  periodDebit: number;
  periodCredit: number;
  periodBalance: number;
  periodNetMovement: number;
  openingBalance: number;
  closingBalance: number;

  movements: DoctorAccountMovement[];
  ledger: DoctorAccountLedger;
};

export type AddDoctorSupplyIssueInput = {
  doctorId: string;
  occurredAt: string;
  notes?: string | null;
  idempotencyKey: string;

  items: Array<{
    sourceType:
      | "consumable"
      | "stent"
      | "equipment"
      | "manual";

    sourceReferenceId?: string | null;

    /*
     * For catalog-backed rows the server resolves the real name
     * from the catalog and ignores a forged client name.
     *
     * For manual rows this field is required.
     */
    name?: string | null;

    quantity: number;
    unitPrice: number;
    notes?: string | null;
  }>;
};

const number = (value: unknown) => Number(value ?? 0);

export const DOCTOR_ACCOUNT_TIMEZONE = "Africa/Cairo" as const;

const businessDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string) {
  if (!businessDatePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

export function validateDoctorAccountPeriod(from?: string, to?: string) {
  if ((from && !isCalendarDate(from)) || (to && !isCalendarDate(to))) {
    throw new OperationDomainError(
      400,
      "DOCTOR_ACCOUNT_PERIOD_INVALID",
      "صيغة فترة حساب الطبيب غير صحيحة.",
    );
  }
  if (from && to && from > to) {
    throw new OperationDomainError(
      400,
      "DOCTOR_ACCOUNT_PERIOD_INVALID",
      "تاريخ بداية الفترة يجب ألا يكون بعد تاريخ نهايتها.",
    );
  }
  return { from: from ?? null, to: to ?? null };
}

const iso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : String(value);

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function assertPositiveMoney(value: number, message: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new OperationDomainError(
      400,
      "DOCTOR_ACCOUNT_AMOUNT_INVALID",
      message,
    );
  }
}

function assertNonNegativeMoney(
  value: number,
  message: string,
) {
  if (!Number.isFinite(value) || value < 0) {
    throw new OperationDomainError(
      400,
      "DOCTOR_ACCOUNT_AMOUNT_INVALID",
      message,
    );
  }
}

/*
 * Canonical doctor-account ledger.
 *
 * Positive signed_amount = amount owed by the doctor.
 * Negative signed_amount = payment / credit in favor of doctor.
 *
 * Contract operations are intentionally excluded.
 */
const movementUnion = `
  select
    p.id,
    p.doctor_id,
    p.posted_at occurred_at,
    'operation_posting'::text movement_type,
    ('ترحيل حالة: ' || coalesce(p.case_name_snapshot, o.case_name)) description,
    case when p.direction = 'credit' then -p.amount else p.amount end signed_amount,
    p.operation_id,
    coalesce(p.case_name_snapshot, o.case_name) case_name,
    coalesce(p.operation_type_snapshot, o.type)::text operation_type,
    p.doctor_name_snapshot,
    p.reference_amount_snapshot,
    p.difference_amount_snapshot,
    null::text notes
  from doctor_account_postings p
  left join operations o
    on o.id = p.operation_id
  where
    p.reversed = false
    and coalesce(p.operation_type_snapshot, o.type) in ('lithotripsy', 'endoscopy')

  union all

  select
    s.id,
    s.doctor_id,
    s.occurred_at,
    'supply_issue'::text movement_type,
    'صرف مستلزمات'::text description,
    coalesce(
      (
        select sum(i.total_amount)
        from doctor_supply_issue_items i
        where i.issue_id = s.id
      ),
      0
    ) signed_amount,
    null::uuid operation_id,
    null::varchar case_name,
    null::text operation_type,
    null::varchar doctor_name_snapshot,
    null::numeric reference_amount_snapshot,
    null::numeric difference_amount_snapshot,
    s.notes
  from doctor_supply_issues s
  where s.reversed = false

  union all

  select
    p.id,
    p.doctor_id,
    p.paid_at occurred_at,
    'payment'::text movement_type,
    'دفعة من الطبيب'::text description,
    -p.amount signed_amount,
    null::uuid operation_id,
    null::varchar case_name,
    null::text operation_type,
    null::varchar doctor_name_snapshot,
    null::numeric reference_amount_snapshot,
    null::numeric difference_amount_snapshot,
    p.notes
  from doctor_payments p
  where p.reversed = false

  union all

  select
    a.id,
    a.doctor_id,
    a.occurred_at,
    'adjustment'::text movement_type,
    a.description,
    case
      when a.direction = 'debit'
        then a.amount
      else -a.amount
    end signed_amount,
    null::uuid operation_id,
    null::varchar case_name,
    null::text operation_type,
    null::varchar doctor_name_snapshot,
    null::numeric reference_amount_snapshot,
    null::numeric difference_amount_snapshot,
    a.notes
  from doctor_account_adjustments a
  where a.reversed = false
`;

export async function listDoctorAccounts(
  search = "",
  from?: string,
  to?: string,
) {
  const periodFilter = validateDoctorAccountPeriod(from, to);
  const rows = await postgresClient.unsafe<DbRow[]>(
    `
      with movements as (${movementUnion})
      select
        d.id doctor_id,
        d.name doctor_name,
        d.specialty,

        coalesce(
          sum(m.signed_amount) filter(
            where
              $3::date is null
              or m.occurred_at < ((($3::date + 1)::date)::timestamp at time zone 'Africa/Cairo')
          ),
          0
        ) balance,

        count(m.id) filter(
          where
            (
              $2::date is null
              or m.occurred_at >= ($2::date::timestamp at time zone 'Africa/Cairo')
            )
            and
            (
              $3::date is null
              or m.occurred_at < ((($3::date + 1)::date)::timestamp at time zone 'Africa/Cairo')
            )
        ) movement_count,

        max(m.occurred_at) filter(
          where
            (
              $2::date is null
              or m.occurred_at >= ($2::date::timestamp at time zone 'Africa/Cairo')
            )
            and
            (
              $3::date is null
              or m.occurred_at < ((($3::date + 1)::date)::timestamp at time zone 'Africa/Cairo')
            )
        ) last_movement_at

      from doctors d

      left join movements m
        on m.doctor_id = d.id

      where
        (
          d.archived_at is null
          or m.id is not null
        )
        and
        (
          $1 = ''
          or d.name ilike '%' || $1 || '%'
        )

      group by
        d.id,
        d.name,
        d.specialty

      order by
        case
          when coalesce(
            sum(m.signed_amount) filter(
              where
                $3::date is null
                or m.occurred_at < ((($3::date + 1)::date)::timestamp at time zone 'Africa/Cairo')
            ),
            0
          ) <> 0
            then 0
          else 1
        end,
        d.name
    `,
    [
      search.trim(),
      periodFilter.from,
      periodFilter.to,
    ],
  );

  return rows.map(
    (row): DoctorAccountSummary => ({
      doctorId: String(row.doctor_id),

      doctorName: String(row.doctor_name),

      specialty: row.specialty
        ? String(row.specialty)
        : null,

      balance: number(row.balance),

      movementCount: number(row.movement_count),

      lastMovementAt: row.last_movement_at
        ? iso(row.last_movement_at)
        : null,
    }),
  );
}

async function getSupplyItems(
  issueIds: string[],
): Promise<Map<string, DoctorSupplyItem[]>> {
  const result = new Map<string, DoctorSupplyItem[]>();

  if (!issueIds.length) {
    return result;
  }

  const rows = await postgresClient.unsafe<DbRow[]>(
    `
      select
        id,
        issue_id,
        source_type::text source_type,
        source_reference_id,
        item_name_snapshot,
        quantity,
        unit_price,
        total_amount,
        notes
      from doctor_supply_issue_items
      where issue_id = any($1::uuid[])
      order by
        issue_id,
        sort_order,
        created_at,
        id
    `,
    [issueIds],
  );

  for (const row of rows) {
    const issueId = String(row.issue_id);

    const items = result.get(issueId) ?? [];

    items.push({
      id: String(row.id),

      sourceType:
        row.source_type as DoctorSupplyItem["sourceType"],

      sourceReferenceId: row.source_reference_id
        ? String(row.source_reference_id)
        : null,

      name: String(row.item_name_snapshot),

      quantity: number(row.quantity),

      unitPrice: number(row.unit_price),

      totalAmount: number(row.total_amount),

      notes: row.notes
        ? String(row.notes)
        : null,
    });

    result.set(issueId, items);
  }

  return result;
}

/*
 * Resolve the original/reference amount for posted operations.
 *
 * The posting amount itself always comes from
 * doctor_account_postings.amount and is therefore authoritative.
 *
 * The reference amount is presentation context only.
 *
 * We resolve it from the saved financial review without changing
 * any historical doctor-account value.
 */
async function getOperationReferenceAmounts(
  operationIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();

  if (!operationIds.length) {
    return result;
  }

  /*
   * Legacy main-amount reviews retain their original main_amount
   * interpretation. Direct-items reviews instead sum the persisted,
   * included base snapshots: their main_amount is intentionally zero and
   * is not a meaningful reference price.
   */
  const rows = await postgresClient.unsafe<DbRow[]>(
    `
      select
        fr.operation_id,
        fr.accounting_mode,
        fr.main_amount,
        i.kind,
        i.financial_effect,
        i.case_line_state,
        i.base_amount,
        i.effective_amount,
        i.amount
      from operation_financial_reviews fr
      left join operation_financial_items i
        on i.review_id = fr.id
      where
        fr.operation_id = any($1::uuid[])
      order by fr.operation_id, i.created_at, i.id
    `,
    [operationIds],
  );

  const grouped = new Map<string, DbRow[]>();
  for (const row of rows) {
    const operationId = String(row.operation_id);
    const items = grouped.get(operationId) ?? [];
    items.push(row);
    grouped.set(operationId, items);
  }
  for (const [operationId, reviewRows] of grouped) {
    const first = reviewRows[0];
    result.set(operationId, calculateSavedOperationReferenceAmount({
      accountingMode: String(first.accounting_mode) as "main_amount" | "direct_items",
      mainAmount: first.main_amount,
      items: reviewRows.map((row) => ({
        kind: row.kind,
        financialEffect: row.financial_effect,
        caseLineState: row.case_line_state,
        baseAmount: row.base_amount,
        effectiveAmount: row.effective_amount,
        amount: row.amount,
      })),
    }));
  }

  return result;
}

export function calculateSavedOperationReferenceAmount(input: {
  accountingMode: "main_amount" | "direct_items";
  mainAmount: unknown;
  items: Array<{
    kind: unknown;
    financialEffect: unknown;
    caseLineState: unknown;
    baseAmount: unknown;
    effectiveAmount: unknown;
    amount: unknown;
  }>;
}) {
  if (input.accountingMode === "main_amount") return money(number(input.mainAmount));
  return money(input.items.reduce((sum, item) => {
    if (
      item.kind !== "financial" ||
      item.financialEffect === "neutral" ||
      item.caseLineState !== "included"
    ) return sum;
    return sum + number(item.baseAmount ?? item.effectiveAmount ?? item.amount);
  }, 0));
}

export type LedgerMovementInput = Omit<
  DoctorAccountMovement,
  "balanceBefore" | "balanceAfter"
>;

export function buildDoctorAccountLedger(
  movements: LedgerMovementInput[],
  openingBalance: number,
  from: string | null,
  to: string | null,
): DoctorAccountLedger {
  let runningBalance = money(openingBalance);
  let periodDebit = 0;
  let periodCredit = 0;
  const days: DoctorAccountLedgerDay[] = [];

  for (const movement of movements) {
    const balanceBefore = runningBalance;
    runningBalance = money(runningBalance + movement.signedAmount);
    periodDebit = money(periodDebit + movement.debitAmount);
    periodCredit = money(periodCredit + movement.creditAmount);
    const projected = { ...movement, balanceBefore, balanceAfter: runningBalance };
    let day = days.at(-1);
    if (!day || day.date !== movement.businessDate) {
      day = {
        date: movement.businessDate,
        openingBalance: balanceBefore,
        debitTotal: 0,
        creditTotal: 0,
        netMovement: 0,
        closingBalance: balanceBefore,
        movements: [],
      };
      days.push(day);
    }
    day.movements.push(projected);
    day.debitTotal = money(day.debitTotal + movement.debitAmount);
    day.creditTotal = money(day.creditTotal + movement.creditAmount);
    day.netMovement = money(day.debitTotal - day.creditTotal);
    day.closingBalance = runningBalance;
  }

  const periodNetMovement = money(periodDebit - periodCredit);
  return {
    timezone: DOCTOR_ACCOUNT_TIMEZONE,
    from,
    to,
    openingBalance: money(openingBalance),
    periodDebit,
    periodCredit,
    periodNetMovement,
    closingBalance: money(openingBalance + periodNetMovement),
    days,
  };
}

export async function getDoctorAccount(
  doctorId: string,
  from?: string,
  to?: string,
): Promise<DoctorAccountDetails> {
  const periodFilter = validateDoctorAccountPeriod(from, to);
  const [doctor] =
    await postgresClient.unsafe<DbRow[]>(
      `
        select
          id,
          name,
          specialty
        from doctors
        where id = $1::uuid
      `,
      [doctorId],
    );

  if (!doctor) {
    throw new OperationDomainError(
      404,
      "DOCTOR_NOT_FOUND",
      "الطبيب غير موجود.",
    );
  }

  const [opening] =
    await postgresClient.unsafe<DbRow[]>(
      `
        with movements as (${movementUnion})
        select
          coalesce(sum(signed_amount), 0) opening_balance
        from movements
        where
          doctor_id = $1::uuid
          and $2::date is not null
          and occurred_at < ($2::date::timestamp at time zone 'Africa/Cairo')
      `,
      [doctorId, periodFilter.from],
    );

  const rows =
    await postgresClient.unsafe<DbRow[]>(
      `
        with movements as (${movementUnion})
        select
          movements.*,
          to_char(
            occurred_at at time zone 'Africa/Cairo',
            'YYYY-MM-DD'
          ) business_date
        from movements

        where
          doctor_id = $1::uuid
          and
          (
            $2::date is null
            or occurred_at >= ($2::date::timestamp at time zone 'Africa/Cairo')
          )
          and
          (
            $3::date is null
            or occurred_at < ((($3::date + 1)::date)::timestamp at time zone 'Africa/Cairo')
          )

        order by
          occurred_at asc,
          movement_type asc,
          id asc
      `,
      [
        doctorId,
        periodFilter.from,
        periodFilter.to,
      ],
    );

  const supplyIssueIds = rows
    .filter(
      (row) =>
        String(row.movement_type) ===
        "supply_issue",
    )
    .map((row) => String(row.id));

  const operationIds = rows
    .filter(
      (row) =>
        String(row.movement_type) ===
          "operation_posting" &&
        row.operation_id &&
        row.reference_amount_snapshot == null,
    )
    .map((row) => String(row.operation_id));

  const [
    supplyItems,
    operationReferenceAmounts,
  ] = await Promise.all([
    getSupplyItems(supplyIssueIds),

    getOperationReferenceAmounts(
      operationIds,
    ),
  ]);

  const movementInputs = rows.map(
    (row): LedgerMovementInput => {
      const signedAmount =
        number(row.signed_amount);

      const type =
        row.movement_type as DoctorAccountMovement["type"];

      const operationId =
        row.operation_id
          ? String(row.operation_id)
          : null;

      return {
        id: String(row.id),

        type,

        occurredAt: iso(row.occurred_at),

        description: String(row.description),

        amount: Math.abs(signedAmount),

        signedAmount,

        debitAmount: signedAmount > 0 ? signedAmount : 0,

        creditAmount: signedAmount < 0 ? Math.abs(signedAmount) : 0,

        effect:
          signedAmount >= 0
            ? "debit"
            : "credit",

        businessDate: String(row.business_date),

        operationId,

        caseName: row.case_name
          ? String(row.case_name)
          : null,

        operationType: row.operation_type
          ? String(row.operation_type)
          : null,

        doctorNameSnapshot: row.doctor_name_snapshot
          ? String(row.doctor_name_snapshot)
          : null,

        operationReferenceAmount:
          row.reference_amount_snapshot != null
            ? number(row.reference_amount_snapshot)
            : operationId && operationReferenceAmounts.has(operationId)
              ? operationReferenceAmounts.get(operationId) ?? null
              : null,

        operationPostedAmount:
          type === "operation_posting"
            ? Math.abs(signedAmount)
            : null,

        operationDifferenceAmount:
          type !== "operation_posting"
            ? null
            : row.difference_amount_snapshot != null
              ? number(row.difference_amount_snapshot)
              : operationId && operationReferenceAmounts.has(operationId)
                ? money(
                    Math.abs(signedAmount) -
                      (operationReferenceAmounts.get(operationId) ?? 0),
                  )
                : null,

        supplyItems:
          type === "supply_issue"
            ? supplyItems.get(
                String(row.id),
              ) ?? []
            : [],

        notes: row.notes
          ? String(row.notes)
          : null,
      };
    },
  );

  const ledger = buildDoctorAccountLedger(
    movementInputs,
    number(opening.opening_balance),
    periodFilter.from,
    periodFilter.to,
  );
  const movements = ledger.days.flatMap((day) => day.movements);
  const lastMovement = movements.at(-1) ?? null;

  return {
    doctor: {
      id: String(doctor.id),

      name: String(doctor.name),

      specialty: doctor.specialty
        ? String(doctor.specialty)
        : null,
    },

    balance: ledger.closingBalance,

    movementCount:
      movements.length,

    lastMovementAt:
      lastMovement
        ? lastMovement.occurredAt
        : null,

    totalDebit:
      ledger.periodDebit,

    totalCredit:
      ledger.periodCredit,

    periodDebit:
      ledger.periodDebit,

    periodCredit:
      ledger.periodCredit,

    periodBalance:
      ledger.periodNetMovement,

    periodNetMovement: ledger.periodNetMovement,

    openingBalance: ledger.openingBalance,

    closingBalance: ledger.closingBalance,

    movements,

    ledger,
  };
}

async function resolveSupplyItemName(
tx: TransactionSql<Record<string, never>>,
  item: AddDoctorSupplyIssueInput["items"][number],
) {
  if (item.sourceType === "manual") {
    const name =
      item.name?.trim() ?? "";

    if (name.length < 2) {
      throw new OperationDomainError(
        400,
        "DOCTOR_SUPPLY_MANUAL_NAME_REQUIRED",
        "اسم المستلزم اليدوي مطلوب.",
      );
    }

    return {
      name,
      referenceId: null,
    };
  }

  if (!item.sourceReferenceId) {
    throw new OperationDomainError(
      400,
      "DOCTOR_SUPPLY_REFERENCE_REQUIRED",
      "يجب اختيار المستلزم من البيانات المسجلة.",
    );
  }

  let tableName:
    | "consumables"
    | "stents"
    | "equipment";

  switch (item.sourceType) {
    case "consumable":
      tableName = "consumables";
      break;

    case "stent":
      tableName = "stents";
      break;

    case "equipment":
      tableName = "equipment";
      break;

    default:
      throw new OperationDomainError(
        400,
        "DOCTOR_SUPPLY_SOURCE_INVALID",
        "نوع المستلزم غير صحيح.",
      );
  }

  /*
   * tableName is chosen only from the hard-coded allow-list above.
   * It never comes directly from client input.
   */
  const [catalog] =
    await tx.unsafe<DbRow[]>(
      `
        select
          id,
          name
        from ${tableName}
        where
          id = $1::uuid
          and archived_at is null
          and is_active = true
      `,
      [item.sourceReferenceId],
    );

  if (!catalog) {
    throw new OperationDomainError(
      404,
      "DOCTOR_SUPPLY_CATALOG_ITEM_NOT_FOUND",
      "المستلزم المحدد غير موجود أو تمت أرشفته.",
    );
  }

  return {
    name: String(catalog.name),

    referenceId: String(catalog.id),
  };
}

export async function addDoctorSupplyIssue(
  input: AddDoctorSupplyIssueInput,
  userId: string,
) {
  if (!input.items.length) {
    throw new OperationDomainError(
      400,
      "DOCTOR_SUPPLY_ITEMS_REQUIRED",
      "أضف مستلزمًا واحدًا على الأقل.",
    );
  }

  if (input.items.length > 100) {
    throw new OperationDomainError(
      400,
      "DOCTOR_SUPPLY_ITEMS_LIMIT",
      "عدد البنود في حركة الصرف أكبر من الحد المسموح.",
    );
  }

  return postgresClient.begin(
    async (tx) => {
      const [doctor] =
        await tx.unsafe<DbRow[]>(
          `
            select id
            from doctors
            where id = $1::uuid
          `,
          [input.doctorId],
        );

      if (!doctor) {
        throw new OperationDomainError(
          404,
          "DOCTOR_NOT_FOUND",
          "الطبيب غير موجود.",
        );
      }

      await tx.unsafe(
        "select pg_advisory_xact_lock(hashtextextended($1,0))",
        [input.idempotencyKey],
      );

      /*
       * Resolve every catalog-backed name server-side before
       * creating the movement.
       */
      const resolvedItems: Array<{
        sourceType:
          AddDoctorSupplyIssueInput["items"][number]["sourceType"];
        sourceReferenceId: string | null;
        name: string;
        quantity: number;
        unitPrice: number;
        totalAmount: number;
        notes: string | null;
      }> = [];

      for (const item of input.items) {
        assertPositiveMoney(
          item.quantity,
          "الكمية يجب أن تكون أكبر من صفر.",
        );

        assertNonNegativeMoney(
          item.unitPrice,
          "سعر الوحدة غير صحيح.",
        );

        const resolved =
          await resolveSupplyItemName(
            tx,
            item,
          );

        const quantity =
          money(item.quantity);

        const unitPrice =
          money(item.unitPrice);

        /*
         * The total is NEVER accepted from the client.
         * It is calculated authoritatively here.
         */
        const totalAmount = money(
          quantity * unitPrice,
        );

        resolvedItems.push({
          sourceType: item.sourceType,

          sourceReferenceId:
            resolved.referenceId,

          name: resolved.name,

          quantity,

          unitPrice,

          totalAmount,

          notes:
            item.notes?.trim() || null,
        });
      }

      const grandTotal = money(
        resolvedItems.reduce(
          (sum, item) =>
            sum + item.totalAmount,
          0,
        ),
      );

      if (grandTotal <= 0) {
        throw new OperationDomainError(
          400,
          "DOCTOR_SUPPLY_TOTAL_INVALID",
          "إجمالي حركة الصرف يجب أن يكون أكبر من صفر.",
        );
      }

      const [existing] =
        await tx.unsafe<DbRow[]>(
          `
            select
              id,
              doctor_id,
              occurred_at
            from doctor_supply_issues
            where idempotency_key = $1
          `,
          [input.idempotencyKey],
        );

      if (existing) {
        const existingItems = await tx.unsafe<DbRow[]>(
          `select source_type,source_reference_id,item_name_snapshot,
                  quantity,unit_price,total_amount
             from doctor_supply_issue_items
            where issue_id=$1::uuid
            order by sort_order,id`,
          [String(existing.id)],
        );
        const sameItems =
          existingItems.length === resolvedItems.length &&
          existingItems.every((stored, index) => {
            const requested = resolvedItems[index];
            return (
              String(stored.source_type) === requested.sourceType &&
              String(stored.source_reference_id ?? "") ===
                String(requested.sourceReferenceId ?? "") &&
              (requested.sourceType !== "manual" ||
                String(stored.item_name_snapshot) === requested.name) &&
              money(number(stored.quantity)) === requested.quantity &&
              money(number(stored.unit_price)) === requested.unitPrice &&
              money(number(stored.total_amount)) === requested.totalAmount
            );
          });
        if (
          String(existing.doctor_id) !== input.doctorId ||
          new Date(String(existing.occurred_at)).toISOString() !==
            new Date(input.occurredAt).toISOString() ||
          !sameItems
        ) {
          throw new OperationDomainError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "مفتاح حركة الصرف مستخدم لبيانات مختلفة.",
          );
        }

        return {
          id: String(existing.id),
          totalAmount: money(
            existingItems.reduce(
              (sum, item) => sum + number(item.total_amount),
              0,
            ),
          ),
          duplicated: true,
        };
      }

      const [issue] =
        await tx.unsafe<DbRow[]>(
          `
            insert into doctor_supply_issues (
              doctor_id,
              occurred_at,
              notes,
              idempotency_key,
              created_by_user_id
            )
            values (
              $1::uuid,
              $2::timestamptz,
              $3,
              $4,
              $5::uuid
            )
            returning id
          `,
          [
            input.doctorId,
            input.occurredAt,
            input.notes?.trim() || null,
            input.idempotencyKey,
            userId,
          ],
        );

      if (!issue) {
        throw new OperationDomainError(
          500,
          "DOCTOR_SUPPLY_CREATE_FAILED",
          "تعذر إنشاء حركة صرف المستلزمات.",
        );
      }

      for (
        let index = 0;
        index < resolvedItems.length;
        index++
      ) {
        const item =
          resolvedItems[index];

        await tx.unsafe(
          `
            insert into doctor_supply_issue_items (
              issue_id,
              source_type,
              source_reference_id,
              item_name_snapshot,
              quantity,
              unit_price,
              total_amount,
              sort_order,
              notes
            )
            values (
              $1::uuid,
              $2::doctor_supply_source_type,
              $3::uuid,
              $4,
              $5::numeric,
              $6::numeric,
              $7::numeric,
              $8,
              $9
            )
          `,
          [
            String(issue.id),
            item.sourceType,
            item.sourceReferenceId,
            item.name,
            item.quantity,
            item.unitPrice,
            item.totalAmount,
            index,
            item.notes,
          ],
        );
      }

      return {
        id: String(issue.id),
        totalAmount: grandTotal,
        duplicated: false,
      };
    },
  );
}

export async function addDoctorAdjustment(
  input: {
    doctorId: string;
    direction: "debit" | "credit";
    amount: number;
    occurredAt: string;
    description: string;
    notes?: string | null;
    idempotencyKey: string;
  },
  userId: string,
) {
  assertPositiveMoney(
    input.amount,
    "مبلغ الحركة يجب أن يكون أكبر من صفر.",
  );

  const [row] =
    await postgresClient.unsafe<DbRow[]>(
      `
        insert into doctor_account_adjustments (
          doctor_id,
          direction,
          amount,
          occurred_at,
          description,
          notes,
          idempotency_key,
          created_by_user_id
        )
        values (
          $1::uuid,
          $2,
          $3,
          $4::timestamptz,
          $5,
          $6,
          $7,
          $8::uuid
        )

        on conflict(idempotency_key)
        do update
          set idempotency_key =
            excluded.idempotency_key
        where
          doctor_account_adjustments.doctor_id =
            excluded.doctor_id
          and doctor_account_adjustments.direction = excluded.direction
          and doctor_account_adjustments.amount = excluded.amount
          and doctor_account_adjustments.occurred_at = excluded.occurred_at
          and doctor_account_adjustments.description = excluded.description

        returning id
      `,
      [
        input.doctorId,
        input.direction,
        money(input.amount),
        input.occurredAt,
        input.description,
        input.notes ?? null,
        input.idempotencyKey,
        userId,
      ],
    );

  if (!row) {
    throw new OperationDomainError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "مفتاح الحركة مستخدم لبيانات مختلفة.",
    );
  }

  return {
    id: String(row.id),
  };
}

export async function addDoctorPayment(
  input: {
    doctorId: string;
    amount: number;
    paidAt: string;
    notes?: string | null;
    idempotencyKey: string;
  },
  userId: string,
) {
  assertPositiveMoney(
    input.amount,
    "مبلغ الدفعة يجب أن يكون أكبر من صفر.",
  );

  return postgresClient.begin(
    async (tx) => {
      /*
       * Lock the doctor's row so two simultaneous payment requests
       * cannot both validate against the same balance.
       */
      const [doctor] =
        await tx.unsafe<DbRow[]>(
          `
            select id
            from doctors
            where id = $1::uuid
            for update
          `,
          [input.doctorId],
        );

      if (!doctor) {
        throw new OperationDomainError(
          404,
          "DOCTOR_NOT_FOUND",
          "الطبيب غير موجود.",
        );
      }


      await tx.unsafe(
        "select pg_advisory_xact_lock(hashtextextended($1,0))",
        [input.idempotencyKey],
      );

      const [existing] =
        await tx.unsafe<DbRow[]>(
          `
            select
              id,
              doctor_id,
              amount,
              paid_at
            from doctor_payments
            where idempotency_key = $1
          `,
          [input.idempotencyKey],
        );

      if (existing) {
        if (
          String(existing.doctor_id) !==
            input.doctorId ||
          money(number(existing.amount)) !==
            money(input.amount) ||
          new Date(String(existing.paid_at)).toISOString() !==
            new Date(input.paidAt).toISOString()
        ) {
          throw new OperationDomainError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "مفتاح الدفعة مستخدم لعملية مختلفة.",
          );
        }

        return {
          id: String(existing.id),
        };
      }

      const [balance] =
        await tx.unsafe<DbRow[]>(
          `
            with movements as (${movementUnion})
            select
              coalesce(
                sum(signed_amount),
                0
              ) balance
            from movements
            where doctor_id = $1::uuid
          `,
          [input.doctorId],
        );

      const currentBalance =
        money(number(balance.balance));

      const paymentAmount =
        money(input.amount);

      if (
        currentBalance <= 0 ||
        paymentAmount > currentBalance
      ) {
        throw new OperationDomainError(
          409,
          "PAYMENT_EXCEEDS_DOCTOR_BALANCE",
          "الدفعة أكبر من الرصيد المستحق على الطبيب.",
        );
      }

      const [row] =
        await tx.unsafe<DbRow[]>(
          `
            insert into doctor_payments (
              doctor_id,
              amount,
              paid_at,
              notes,
              idempotency_key,
              created_by_user_id
            )
            values (
              $1::uuid,
              $2,
              $3::timestamptz,
              $4,
              $5,
              $6::uuid
            )
            returning id
          `,
          [
            input.doctorId,
            paymentAmount,
            input.paidAt,
            input.notes ?? null,
            input.idempotencyKey,
            userId,
          ],
        );

      if (!row) {
        throw new OperationDomainError(
          500,
          "DOCTOR_PAYMENT_CREATE_FAILED",
          "تعذر تسجيل الدفعة.",
        );
      }

      return {
        id: String(row.id),
      };
    },
  );
}
