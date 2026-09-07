"use client";

import { useCallback, useEffect, useState } from "react";
import { ExpenseForm } from "./expense-form";
import type { ExpenseListDto } from "@/lib/expenses/service";

type ExpenseStatus = "unpaid" | "paid" | "all";
const monthFormatter = new Intl.DateTimeFormat("ar-EG", { month: "long", year: "numeric", timeZone: "Africa/Cairo" });
const dayFormatter = new Intl.DateTimeFormat("ar-EG", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Cairo" });
const moneyFormatter = new Intl.NumberFormat("ar-EG", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
function currentMonth() { const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit" }).formatToParts(new Date()); const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ""; return `${part("year")}-${part("month")}`; }
function cairoToday() { const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ""; return `${part("year")}-${part("month")}-${part("day")}`; }
function shiftDay(value: string, amount: number) { const [year, month, day] = value.split("-").map(Number); return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10); }
function shiftMonth(value: string, amount: number) { const [year, month] = value.split("-").map(Number); return new Date(Date.UTC(year, month - 1 + amount, 1)).toISOString().slice(0, 7); }
function formatMonth(value: string) { return monthFormatter.format(new Date(`${value}-15T12:00:00Z`)); }
function formatDay(value: string) { return dayFormatter.format(new Date(`${value}T12:00:00Z`)); }
function money(value: string) { const parsed = Number(value); return Number.isFinite(parsed) ? moneyFormatter.format(parsed) : value; }

export function ExpensesList({ isOwner, canCreate }: { isOwner: boolean; canCreate: boolean }) {
  const [month, setMonth] = useState(currentMonth);
  const [status, setStatus] = useState<ExpenseStatus>("unpaid");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ExpenseListDto | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [payingId, setPayingId] = useState("");

  const load = useCallback(async (nextPage = 1, nextStatus = status, nextMonth = month) => {
    setBusy(true); setError("");
    try {
      const query = new URLSearchParams({ status: nextStatus, page: String(nextPage), pageSize: "7" });
      if (isOwner || nextStatus !== "unpaid") query.set("month", nextMonth);
      else { const today = cairoToday(); query.set("from", shiftDay(today, -365)); query.set("to", today); }
      const response = await fetch(`/api/v1/expenses?${query}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body.error?.message ?? "تعذر تحميل المصروفات."); return; }
      setData(body as ExpenseListDto); setPage(nextPage);
    } catch { setError("تعذر الاتصال بالخادم. حاول مرة أخرى."); }
    finally { setBusy(false); }
  }, [isOwner, month, status]);

  useEffect(() => { queueMicrotask(() => void load(1)); }, [load]);
  function changeStatus(next: ExpenseStatus) { setStatus(next); setPage(1); }
  function changeMonth(amount: number) { setMonth((current) => shiftMonth(current, amount)); setPage(1); }
  async function markPaid(id: string) {
    if (payingId) return; setPayingId(id); setError("");
    try {
      const response = await fetch(`/api/v1/expenses/${id}/mark-paid`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body.error?.message ?? "تعذر تسجيل السداد."); return; }
      await load(page);
    } catch { setError("تعذر الاتصال بالخادم لتسجيل السداد."); }
    finally { setPayingId(""); }
  }

  return (
    <main className={`expenses-workflow ${isOwner ? "is-owner" : "is-employee"}`} dir="rtl">
      {canCreate && <ExpenseForm onSaved={() => void load(1, "unpaid", month)} />}
      <section className="expense-worklist">
        <header className="expense-worklist__heading">
          <div><span>{isOwner ? "قائمة السداد" : "مستحقاتك"}</span><h2>{isOwner ? "تعويض مصاريف الموظفين" : status === "unpaid" ? "مصاريفي المستحقة" : "سجل مصاريفي"}</h2></div>
          {!isOwner && <button type="button" onClick={() => changeStatus(status === "unpaid" ? "all" : "unpaid")}>{status === "unpaid" ? "سجل مصاريفي" : "عرض المستحق فقط"}</button>}
        </header>

        {isOwner && <div className="expense-owner-controls">
          <div className="expense-status-tabs" role="group" aria-label="حالة السداد">
            {(["unpaid", "paid", "all"] as const).map((value) => <button type="button" className={status === value ? "active" : ""} aria-pressed={status === value} onClick={() => changeStatus(value)} key={value}>{value === "unpaid" ? "غير المسدد" : value === "paid" ? "تم السداد" : "الكل"}</button>)}
          </div>
          <div className="expense-month-nav"><button type="button" aria-label="الشهر التالي" onClick={() => changeMonth(1)}>‹</button><strong>{formatMonth(month)}</strong><button type="button" aria-label="الشهر السابق" onClick={() => changeMonth(-1)}>›</button></div>
        </div>}

        {error && <p className="form-error expenses-notice" role="alert">{error}</p>}
        {data && <div className={`expense-todo-days ${busy ? "is-loading" : ""}`} aria-busy={busy}>
          {isOwner && <div className="expense-scope-total"><span>{status === "unpaid" ? "إجمالي غير المسدد" : status === "paid" ? "إجمالي المسدد" : "إجمالي الشهر"}</span><strong dir="ltr">{money(data.totalAmount)} ج.م</strong></div>}
          {data.days.map((day) => <article className="expense-todo-day" key={day.date}>
            <header><div><small>اليوم</small><h3>{formatDay(day.date)}</h3></div><div><small>إجمالي اليوم</small><strong dir="ltr">{money(day.dayTotal)} ج.م</strong></div></header>
            <div className="expense-todo-employees">{day.employees.map((employee) => <section className="expense-todo-employee" key={employee.userId}>
              {isOwner && <header><span className="expense-avatar">{employee.employeeName.trim().charAt(0) || "م"}</span><div><small>الموظف</small><h4>{employee.employeeName}</h4></div><strong dir="ltr">{money(employee.employeeSubtotal)} ج.م</strong></header>}
              <div>{employee.entries.map((entry) => <article className="expense-todo-entry" key={entry.id}>
                <div className="expense-todo-entry__main"><strong dir="ltr">{money(entry.amount)} ج.م</strong><p>{entry.description}</p>{entry.notes && <small>{entry.notes}</small>}<time dir="ltr">{entry.time}</time></div>
                <div className={`expense-status is-${entry.reimbursementStatus}`}><span aria-hidden="true">{entry.reimbursementStatus === "paid" ? "🟢" : "🔴"}</span>{entry.reimbursementStatus === "paid" ? "تم السداد" : "لم يتم السداد"}</div>
                {isOwner && entry.reimbursementStatus === "unpaid" && <button className="expense-pay-button" type="button" disabled={Boolean(payingId)} onClick={() => void markPaid(entry.id)}>{payingId === entry.id ? "جارٍ التسجيل…" : "تم السداد"}</button>}
              </article>)}</div>
            </section>)}</div>
          </article>)}
          {!data.days.length && <div className="expenses-empty"><span aria-hidden="true">✓</span><h3>{status === "unpaid" ? "لا توجد مصاريف مستحقة" : "لا توجد مصاريف في هذا الشهر"}</h3><p>{isOwner ? "لا توجد عناصر في قائمة السداد الحالية." : "كل مصاريفك المسجلة ظاهرة هنا عند وجودها."}</p></div>}
          {data.pagination.totalPages > 1 && <nav className="expenses-pagination" aria-label="صفحات أيام المصروفات"><button type="button" disabled={busy || !data.pagination.hasPrevious} onClick={() => void load(page - 1)}>السابق</button><span>صفحة <strong>{page}</strong> من <strong>{data.pagination.totalPages}</strong></span><button type="button" disabled={busy || !data.pagination.hasNext} onClick={() => void load(page + 1)}>التالي</button></nav>}
        </div>}
      </section>
    </main>
  );
}
