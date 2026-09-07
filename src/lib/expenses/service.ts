import type { TransactionSql } from "postgres";
import { postgresClient } from "@/db/client";
import { MAX_EXPENSE_RANGE_DAYS, type ExpenseCreateInput, type ExpenseFilters } from "./validation";

export type ExpenseActor = { id: string; displayName: string; permissions: string[]; role: { code: string } };
export class ExpenseDomainError extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = "ExpenseDomainError"; } }
export type ExpenseDto = { id: string; userId: string; employeeName: string; date: string; time: string; amount: string; categoryId: string; categoryName: string; description: string; notes: string | null; createdAt: string; reimbursementStatus: "unpaid" | "paid"; paidAt: string | null; paidByUserId: string | null };
export type ExpensePagination = { unit: "day"; page: number; pageSize: 7 | 14 | 30; totalDays: number; totalPages: number; hasNext: boolean; hasPrevious: boolean };
export type ExpenseListDto = { range: { from: string; to: string }; scope: "company" | "own"; totalAmount: string; days: Array<{ date: string; dayTotal: string; employees: Array<{ userId: string; employeeName: string; employeeSubtotal: string; entries: Array<{ id: string; time: string; amount: string; categoryId: string; categoryName: string; description: string; notes: string | null; createdAt: string; reimbursementStatus: "unpaid" | "paid"; paidAt: string | null }> }> }>; pagination: ExpensePagination };
export type ExpenseRow = { id: string; created_by_user_id: string; employee_name_snapshot: string; expense_date: string; expense_time: string; amount: string; category_id: string; category_name_snapshot: string; description: string; notes: string | null; created_at: Date | string; reimbursement_status: "unpaid" | "paid"; paid_at: Date | string | null; paid_by_user_id: string | null; day_total?: string; employee_subtotal?: string };
type CategoryRow = { id: string; name: string };

export const isExpenseOwner = (actor: ExpenseActor) => actor.role.code === "owner";
/**
 * Personal expense creation is available to the three canonical application
 * roles. Accountant records created before the permission template was
 * expanded may still have expenses.view only, so that existing role remains
 * eligible for its own expense flow without gaining review authority.
 */
export function canCreatePersonalExpense(actor: ExpenseActor) {
  return actor.permissions.includes("expenses.create") || (actor.role.code === "accountant" && actor.permissions.includes("expenses.view")) || actor.role.code === "owner";
}
export function assertExpenseCreatePermission(actor: ExpenseActor) { if (!canCreatePersonalExpense(actor)) throw new ExpenseDomainError(403, "EXPENSE_CREATE_FORBIDDEN", "ليس لديك صلاحية إضافة مصروف."); }
export function assertExpenseSettlementAuthority(actor: ExpenseActor) { if (!isExpenseOwner(actor)) throw new ExpenseDomainError(403, "EXPENSE_SETTLEMENT_FORBIDDEN", "سداد المصروفات متاح لصاحب الشركة فقط."); }
export function resolveExpenseReadScope(actor: ExpenseActor) {
  if (isExpenseOwner(actor)) return "company" as const;
  if (actor.permissions.includes("expenses.create") || actor.permissions.includes("expenses.view")) return "own" as const;
  throw new ExpenseDomainError(403, "EXPENSE_READ_FORBIDDEN", "ليس لديك صلاحية عرض المصروفات.");
}
const iso = (value: Date | string) => value instanceof Date ? value.toISOString() : String(value);
const columns = `id, created_by_user_id, employee_name_snapshot, expense_date::text expense_date, expense_time, amount::text amount, category_id, category_name_snapshot, description, notes, created_at, reimbursement_status, paid_at, paid_by_user_id`;
function toDto(row: ExpenseRow): ExpenseDto { return { id: row.id, userId: row.created_by_user_id, employeeName: row.employee_name_snapshot, date: row.expense_date, time: row.expense_time, amount: row.amount, categoryId: row.category_id, categoryName: row.category_name_snapshot, description: row.description, notes: row.notes, createdAt: iso(row.created_at), reimbursementStatus: row.reimbursement_status, paidAt: row.paid_at ? iso(row.paid_at) : null, paidByUserId: row.paid_by_user_id }; }
function sameReplay(row: ExpenseRow, input: ExpenseCreateInput, actor: ExpenseActor, category: CategoryRow) { return row.created_by_user_id === actor.id && row.employee_name_snapshot === actor.displayName && row.amount === input.amount && row.category_id === category.id && row.category_name_snapshot === category.name && row.description === input.description && row.notes === input.notes; }
async function findByKey(sql: TransactionSql, key: string) { const [row] = await sql.unsafe<ExpenseRow[]>(`select ${columns} from company_expenses where idempotency_key=$1 limit 1`, [key]); return row; }

export function cairoBusinessNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
}

export async function createExpense(input: ExpenseCreateInput, actor: ExpenseActor) {
  assertExpenseCreatePermission(actor);
  return postgresClient.begin(async (sql) => {
    const now = cairoBusinessNow();
    const [category] = await sql.unsafe<CategoryRow[]>(`select id,name from expense_categories where normalized_name='أخرى' and is_active=true limit 1`);
    if (!category) throw new ExpenseDomainError(500, "EXPENSE_DEFAULT_CATEGORY_MISSING", "فئة المصروف الافتراضية «أخرى» غير موجودة أو غير نشطة.");
    const existing = await findByKey(sql, input.idempotencyKey);
    if (existing) {
      if (!sameReplay(existing, input, actor, category)) throw new ExpenseDomainError(409, "EXPENSE_IDEMPOTENCY_CONFLICT", "مفتاح التكرار مستخدم لطلب مصروف مختلف.");
      return { expense: toDto(existing), idempotent: true };
    }
    const [inserted] = await sql.unsafe<ExpenseRow[]>(`insert into company_expenses (created_by_user_id,employee_name_snapshot,expense_date,expense_time,amount,category_id,category_name_snapshot,description,notes,idempotency_key) values ($1::uuid,$2,$3::date,$4,$5::numeric,$6::uuid,$7,$8,$9,$10) on conflict (idempotency_key) do nothing returning ${columns}`, [actor.id, actor.displayName, now.date, now.time, input.amount, category.id, category.name, input.description, input.notes, input.idempotencyKey]);
    if (inserted) return { expense: toDto(inserted), idempotent: false };
    const raced = await findByKey(sql, input.idempotencyKey);
    if (!raced || !sameReplay(raced, input, actor, category)) throw new ExpenseDomainError(409, "EXPENSE_IDEMPOTENCY_CONFLICT", "مفتاح التكرار مستخدم لطلب مصروف مختلف.");
    return { expense: toDto(raced), idempotent: true };
  });
}

function shiftDate(value: string, days: number) { const [year, month, day] = value.split("-").map(Number); return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10); }
export function resolveExpenseRange(filters: ExpenseFilters) {
  if (filters.month) { const [year, month] = filters.month.split("-").map(Number); return { from: `${filters.month}-01`, to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) }; }
  const to = filters.to ?? cairoBusinessNow().date;
  const from = filters.from ?? shiftDate(to, -30);
  if (from > to) throw new ExpenseDomainError(400, "EXPENSE_RANGE_INVALID", "نطاق التاريخ غير صحيح.");
  if (shiftDate(from, MAX_EXPENSE_RANGE_DAYS - 1) < to) throw new ExpenseDomainError(400, "EXPENSE_RANGE_TOO_LARGE", `نطاق عرض المصروفات لا يجوز أن يتجاوز ${MAX_EXPENSE_RANGE_DAYS} يومًا.`);
  return { from, to };
}
export function buildExpensePagination(page: number, pageSize: 7 | 14 | 30, totalDays: number): ExpensePagination { const totalPages = Math.ceil(totalDays / pageSize); return { unit: "day", page, pageSize, totalDays, totalPages, hasNext: page < totalPages, hasPrevious: totalDays > 0 && page > 1 }; }
export function groupExpenseRows(rows: ExpenseRow[], range: { from: string; to: string }, scope: "company" | "own", totalAmount: string, pagination: ExpensePagination): ExpenseListDto {
  const days: ExpenseListDto["days"] = []; let day: ExpenseListDto["days"][number] | undefined; let employee: ExpenseListDto["days"][number]["employees"][number] | undefined;
  for (const row of rows) {
    if (!day || day.date !== row.expense_date) { day = { date: row.expense_date, dayTotal: String(row.day_total), employees: [] }; days.push(day); employee = undefined; }
    if (!employee || employee.userId !== row.created_by_user_id) { employee = { userId: row.created_by_user_id, employeeName: row.employee_name_snapshot, employeeSubtotal: String(row.employee_subtotal), entries: [] }; day.employees.push(employee); }
    const expense = toDto(row); employee.entries.push({ id: expense.id, time: expense.time, amount: expense.amount, categoryId: expense.categoryId, categoryName: expense.categoryName, description: expense.description, notes: expense.notes, createdAt: expense.createdAt, reimbursementStatus: expense.reimbursementStatus, paidAt: expense.paidAt });
  }
  return { range, scope, totalAmount, days, pagination };
}
type DatePageRow = { total_days: number; total_amount: string };
export function buildExpensePredicate(filters: ExpenseFilters, actor: ExpenseActor, range: { from: string; to: string }) {
  const scope = resolveExpenseReadScope(actor); const values: string[] = [range.from, range.to]; const where = ["expense_date between $1::date and $2::date"];
  if (scope === "own") { values.push(actor.id); where.push(`created_by_user_id = $${values.length}::uuid`); } else if (filters.employeeId) { values.push(filters.employeeId); where.push(`created_by_user_id = $${values.length}::uuid`); }
  if (filters.status !== "all") { values.push(filters.status); where.push(`reimbursement_status = $${values.length}`); }
  if (filters.categoryId) { values.push(filters.categoryId); where.push(`category_id = $${values.length}::uuid`); }
  if (filters.search) { values.push(`%${filters.search}%`); where.push(`(description ilike $${values.length} or coalesce(notes,'') ilike $${values.length} or category_name_snapshot ilike $${values.length} or employee_name_snapshot ilike $${values.length})`); }
  return { scope, values, predicate: where.join(" and ") };
}
export async function listExpenses(filters: ExpenseFilters, actor: ExpenseActor) {
  const range = resolveExpenseRange(filters); const { scope, values, predicate } = buildExpensePredicate(filters, actor, range); const offset = (filters.page - 1) * filters.pageSize;
  const [totals] = await postgresClient.unsafe<DatePageRow[]>(`select count(distinct expense_date)::int total_days,coalesce(sum(amount),0)::text total_amount from company_expenses where ${predicate}`, values);
  const dateRows = await postgresClient.unsafe<Array<{ expense_date: string }>>(`select distinct expense_date::text expense_date from company_expenses where ${predicate} order by expense_date desc limit ${filters.pageSize} offset ${offset}`, values);
  const totalDays = totals?.total_days ?? 0; const totalAmount = totals?.total_amount ?? "0.00"; const selectedDates = dateRows.map((row) => row.expense_date); const pagination = buildExpensePagination(filters.page, filters.pageSize, totalDays);
  if (!selectedDates.length) return groupExpenseRows([], range, scope, totalAmount, pagination);
  const rowValues = [...values, ...selectedDates]; const datePlaceholders = selectedDates.map((_, index) => `$${values.length + index + 1}::date`).join(",");
  const rows = await postgresClient.unsafe<ExpenseRow[]>(`select ${columns},sum(amount) over (partition by expense_date)::text day_total,sum(amount) over (partition by expense_date,created_by_user_id)::text employee_subtotal from company_expenses where ${predicate} and expense_date in (${datePlaceholders}) order by expense_date desc,created_by_user_id,expense_time,created_at,id`, rowValues);
  return groupExpenseRows(rows, range, scope, totalAmount, pagination);
}

export async function markExpensePaid(expenseId: string, actor: ExpenseActor) {
  assertExpenseSettlementAuthority(actor);
  return postgresClient.begin(async (sql) => {
    const [paid] = await sql.unsafe<ExpenseRow[]>(`update company_expenses set reimbursement_status='paid',paid_at=now(),paid_by_user_id=$2::uuid where id=$1::uuid and reimbursement_status='unpaid' returning ${columns}`, [expenseId, actor.id]);
    if (paid) return { expense: toDto(paid), alreadyPaid: false };
    const [existing] = await sql.unsafe<ExpenseRow[]>(`select ${columns} from company_expenses where id=$1::uuid limit 1`, [expenseId]);
    if (!existing) throw new ExpenseDomainError(404, "EXPENSE_NOT_FOUND", "المصروف غير موجود.");
    return { expense: toDto(existing), alreadyPaid: true };
  });
}
export async function listExpenseCategories(actor: ExpenseActor) { resolveExpenseReadScope(actor); const categories = await postgresClient.unsafe<CategoryRow[]>(`select id,name from expense_categories where is_active=true order by normalized_name,id`); return { categories }; }
