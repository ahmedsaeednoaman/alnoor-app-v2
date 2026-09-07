"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { MoneyInput } from "@/components/operations/money-input";
import { SmartSelect } from "@/components/operations/smart-select";
import type {
  DoctorAccountDetails as Account,
  DoctorAccountMovement,
} from "@/lib/doctor-accounts";

const moneyFormatter = new Intl.NumberFormat("ar-EG", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function money(value: number) {
  const normalized = Object.is(value, -0) ? 0 : value;
  return moneyFormatter.format(normalized);
}

function now() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

const cairoDayFormatter = new Intl.DateTimeFormat("ar-EG", {
  timeZone: "Africa/Cairo",
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
});

const cairoTimeFormatter = new Intl.DateTimeFormat("ar-EG", {
  timeZone: "Africa/Cairo",
  hour: "numeric",
  minute: "2-digit",
});

function cairoDate(date: string) {
  return cairoDayFormatter.format(new Date(`${date}T12:00:00+02:00`));
}

function balanceMeta(balance: number) {
  if (balance > 0) return { className: "is-debit", label: "مستحق على الطبيب" };
  if (balance < 0) return { className: "is-credit", label: "رصيد لصالح الطبيب" };
  return { className: "is-zero", label: "الحساب مسوّى" };
}
type SupplySourceType =
  | "consumable"
  | "stent"
  | "equipment"
  | "manual";

type SupplyDraftItem = {
  id: string;
  sourceType: SupplySourceType;
  sourceReferenceId: string;
  manualName: string;
  quantity: string;
  unitPrice: string | null;
  notes: string;
};

const supplySourceLabels: Record<SupplySourceType, string> = {
  consumable: "مستلزم طبي",
  stent: "دعامة",
  equipment: "جهاز / أداة",
  manual: "بند يدوي",
};

const supplyCatalogs: Partial<
  Record<
    SupplySourceType,
    {
      type: string;
      endpoint: string;
    }
  >
> = {
  consumable: {
    type: "consumables",
    endpoint: "/api/v1/catalogs/consumables?active=true&limit=50",
  },
  stent: {
    type: "stents",
    endpoint: "/api/v1/catalogs/stents?active=true&limit=50",
  },
  equipment: {
    type: "equipment",
    endpoint: "/api/v1/catalogs/equipment?active=true&limit=50",
  },
};

function newSupplyItem(): SupplyDraftItem {
  return {
    id: crypto.randomUUID(),
    sourceType: "consumable",
    sourceReferenceId: "",
    manualName: "",
    quantity: "1",
    unitPrice: null,
    notes: "",
  };
}
function movementTypeLabel(movement: DoctorAccountMovement) {
  if (movement.type === "operation_posting") {
    if (movement.operationType === "endoscopy") return "عملية مناظير";
    if (movement.operationType === "lithotripsy") return "عملية تفتيت";
    return "خطأ في نوع حركة العملية";
  }

  if (movement.type === "supply_issue") {
    return "صرف مستلزمات";
  }

  if (movement.type === "payment") {
    return "دفعة من الطبيب";
  }

  return movement.effect === "debit"
    ? "إضافة على حساب الطبيب"
    : "خصم / تسوية";
}

function movementStatus(movement: DoctorAccountMovement) {
  if (movement.effect === "debit") {
    return {
      className: "is-debit",
      sign: "+",
      label: "مدين — يزيد المستحق على الطبيب",
    };
  }

  return {
    className: "is-credit",
    sign: "−",
    label: "دائن — يقلل المستحق على الطبيب",
  };
}

export function DoctorAccountDetails({
  initial,
  canPost,
  canPay,
  canManageCatalogs,
  canViewOperations,
}: {
  initial: Account;
  canPost: boolean;
  canPay: boolean;
  canManageCatalogs: boolean;
  canViewOperations: boolean;
}) {
  const [data, setData] = useState(initial);

  const [mode, setMode] = useState<
    "adjustment" | "payment" | null
  >(null);

  const [amount, setAmount] = useState<string | null>(null);
  const [date, setDate] = useState(now());

  const [direction, setDirection] = useState<
    "debit" | "credit"
  >("debit");

  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");

  const [busy, setBusy] = useState(false);
  const [filterBusy, setFilterBusy] = useState(false);
  const [error, setError] = useState("");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [expandedSupplies, setExpandedSupplies] = useState<Set<string>>(
    new Set(),
  );

  const [supplyOpen, setSupplyOpen] = useState(false);
  const [supplyDate, setSupplyDate] = useState(now());
  const [supplyNotes, setSupplyNotes] = useState("");
  const [supplyItems, setSupplyItems] = useState<SupplyDraftItem[]>([
    newSupplyItem(),
  ]);

  async function reload(from = "", to = "") {
    setFilterBusy(true);
    setError("");

    try {
      const query = new URLSearchParams();

      if (from) query.set("from", from);
      if (to) query.set("to", to);

      const response = await fetch(
        `/api/v1/doctor-accounts/${data.doctor.id}?${query}`,
        { cache: "no-store" },
      );

      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          body?.error?.message ?? "تعذر تحديث حساب الطبيب.",
        );
      }

      setData(body);
      setPeriodFrom(from);
      setPeriodTo(to);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "تعذر تحديث حساب الطبيب.",
      );
    } finally {
      setFilterBusy(false);
    }
  }

  async function save() {
    if (!mode || amount === null || Number(amount) <= 0) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const path =
        mode === "payment" ? "payments" : "adjustments";

      const payload =
        mode === "payment"
          ? {
              amount: Number(amount),
              paidAt: new Date(date).toISOString(),
              notes: notes.trim() || null,
              idempotencyKey: crypto.randomUUID(),
            }
          : {
              direction,
              amount: Number(amount),
              occurredAt: new Date(date).toISOString(),
              description: description.trim(),
              notes: notes.trim() || null,
              idempotencyKey: crypto.randomUUID(),
            };

      const response = await fetch(
        `/api/v1/doctor-accounts/${data.doctor.id}/${path}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          body?.error?.message ?? "تعذر حفظ الحركة.",
        );
      }

      await reload(periodFrom, periodTo);

      setMode(null);
      setAmount(null);
      setDescription("");
      setNotes("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "تعذر حفظ الحركة.",
      );
    } finally {
      setBusy(false);
    }
  }

 const supplyTotal = useMemo(() => {
    return supplyItems.reduce((total, item) => {
      const quantity = Number(item.quantity);
      const unitPrice = Number(item.unitPrice ?? 0);

      if (
        !Number.isFinite(quantity) ||
        !Number.isFinite(unitPrice) ||
        quantity <= 0 ||
        unitPrice < 0
      ) {
        return total;
      }

      return total + quantity * unitPrice;
    }, 0);
  }, [supplyItems]);

  function openSupplyDialog() {
    setError("");
    setSupplyDate(now());
    setSupplyNotes("");
    setSupplyItems([newSupplyItem()]);
    setSupplyOpen(true);
  }

  function updateSupplyItem(
    id: string,
    patch: Partial<SupplyDraftItem>,
  ) {
    setSupplyItems((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch,
            }
          : item,
      ),
    );
  }

  function changeSupplySource(
    id: string,
    sourceType: SupplySourceType,
  ) {
    updateSupplyItem(id, {
      sourceType,
      sourceReferenceId: "",
      manualName: "",
    });
  }

  function addSupplyRow() {
    setSupplyItems((current) => [
      ...current,
      newSupplyItem(),
    ]);
  }

  function removeSupplyRow(id: string) {
    setSupplyItems((current) => {
      if (current.length === 1) {
        return [newSupplyItem()];
      }

      return current.filter((item) => item.id !== id);
    });
  }

  async function saveSupplyIssue() {
    setError("");

    const invalid = supplyItems.some((item) => {
      const quantity = Number(item.quantity);
      const unitPrice = Number(item.unitPrice);

      if (
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        !Number.isFinite(unitPrice) ||
        unitPrice < 0
      ) {
        return true;
      }

      if (item.sourceType === "manual") {
        return item.manualName.trim().length < 2;
      }

      return !item.sourceReferenceId;
    });

    if (invalid) {
      setError(
        "راجع بنود الصرف: اختر البند، وأدخل الكمية وسعر الوحدة بشكل صحيح.",
      );
      return;
    }

    if (supplyTotal <= 0) {
      setError("إجمالي حركة الصرف يجب أن يكون أكبر من صفر.");
      return;
    }

    setBusy(true);

    try {
      const response = await fetch(
        `/api/v1/doctor-accounts/${data.doctor.id}/supplies`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            occurredAt: new Date(supplyDate).toISOString(),
            notes: supplyNotes.trim() || null,
            idempotencyKey: crypto.randomUUID(),
            items: supplyItems.map((item) => ({
              sourceType: item.sourceType,
              sourceReferenceId:
                item.sourceType === "manual"
                  ? null
                  : item.sourceReferenceId,
              name:
                item.sourceType === "manual"
                  ? item.manualName.trim()
                  : null,
              quantity: Number(item.quantity),
              unitPrice: Number(item.unitPrice),
              notes: item.notes.trim() || null,
            })),
          }),
        },
      );

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          body?.error?.message ??
            "تعذر حفظ حركة صرف المستلزمات.",
        );
      }

      await reload(periodFrom, periodTo);

      setSupplyOpen(false);
      setSupplyItems([newSupplyItem()]);
      setSupplyNotes("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "تعذر حفظ حركة صرف المستلزمات.",
      );
    } finally {
      setBusy(false);
    }
  }

  function preset(kind: "current" | "previous") {
    const cairoParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "numeric",
    }).formatToParts(new Date());
    const value = (type: "year" | "month") =>
      Number(cairoParts.find((part) => part.type === type)?.value);
    const currentMonthIndex = value("month") - 1;
    const target = new Date(
      Date.UTC(value("year"), currentMonthIndex - (kind === "previous" ? 1 : 0), 1),
    );
    const year = target.getUTCFullYear();
    const month = target.getUTCMonth() + 1;
    const pad = (number: number) => String(number).padStart(2, "0");
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    void reload(`${year}-${pad(month)}-01`, `${year}-${pad(month)}-${pad(lastDay)}`);
  }

  const closingState = balanceMeta(data.closingBalance);
  const periodLabel = periodFrom && periodTo
    ? `${periodFrom.split("-").reverse().join("/")} — ${periodTo.split("-").reverse().join("/")}`
    : "كل الحركات";

  return (
    <main className="doctor-account-details" dir="rtl">
      <nav className="doctor-account-breadcrumb">
        <Link href="/doctor-accounts">→ حسابات الأطباء</Link>
        <span aria-hidden="true">/</span>
        <strong>{data.doctor.name}</strong>
      </nav>

      <header className="doctor-account-details-hero">
        <div className="doctor-account-details-identity">
          <span
            className="doctor-account-avatar doctor-account-avatar--large"
            aria-hidden="true"
          >
            د
          </span>

          <div>
            <span className="doctor-account-details-eyebrow">
              حساب الطبيب
            </span>

            <h1>{data.doctor.name}</h1>

            <p>
              {data.doctor.specialty ||
                "حساب مرتبط بحالات التفتيت والمناظير"}
            </p>
            <span className="doctor-account-period-label">
              الفترة المعروضة: {periodLabel}
            </span>
            <span className="doctor-account-lifetime-balance">
              الرصيد الكلي حتى الآن: <b>{money(data.balance)} ج.م</b>
              <small> — {balanceMeta(data.balance).label}</small>
            </span>
          </div>
        </div>

        <div className={`doctor-account-header-balance ${closingState.className}`}>
          <span>الرصيد الختامي للفترة</span>
          <strong>{money(data.closingBalance)} <small>ج.م</small></strong>
          <small>{closingState.label}</small>
        </div>
      </header>

      <section className="doctor-account-period-panel" aria-label="اختيار فترة الحساب">
        <div className="doctor-account-periods">
          <span>الفترة المحاسبية</span>
          <div>
            <button disabled={filterBusy} onClick={() => preset("current")}>هذا الشهر</button>
            <button disabled={filterBusy} onClick={() => preset("previous")}>الشهر السابق</button>
            <button disabled={filterBusy} onClick={() => void reload()}>كل الحركات</button>
            <button
              aria-expanded={customOpen}
              disabled={filterBusy}
              onClick={() => setCustomOpen((open) => !open)}
            >
              فترة مخصصة
            </button>
          </div>
        </div>
        {customOpen && (
          <form
            className="doctor-account-custom-period"
            onSubmit={(event) => {
              event.preventDefault();
              if (customFrom && customTo) void reload(customFrom, customTo);
            }}
          >
            <label>من<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} required /></label>
            <label>إلى<input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} required /></label>
            <button className="primary" disabled={filterBusy || !customFrom || !customTo}>تطبيق</button>
            <button type="button" onClick={() => { setCustomFrom(""); setCustomTo(""); void reload(); }}>مسح</button>
          </form>
        )}
      </section>

      {(canPay || canPost) && (
        <section className="doctor-account-actions-panel" aria-label="إجراءات حساب الطبيب">
          <div><span>إجراءات الحساب</span><small>تُحدّث الأرصدة من الخادم بعد الحفظ</small></div>
          <div className="doctor-account-actions">
            {canPay && <button className="primary" onClick={() => { setMode("payment"); setAmount(null); setNotes(""); setDate(now()); }}>تسجيل دفعة</button>}
            {canPost && <button onClick={() => { setMode("adjustment"); setAmount(null); setDescription(""); setNotes(""); setDirection("debit"); setDate(now()); }}>إضافة حركة على الحساب</button>}
            {canPost && <button onClick={openSupplyDialog}>صرف مستلزمات</button>}
          </div>
        </section>
      )}

      {error && (
        <div className="doctor-account-page-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void reload(periodFrom, periodTo)}>إعادة المحاولة</button>
        </div>
      )}

      <section className="doctor-ledger-section">
        <header>
          <div>
            <span>دفتر الحساب اليومي</span>
            <h2>الحركات من الأقدم إلى الأحدث</h2>
          </div>
          <small>{filterBusy ? "جارٍ التحديث..." : `${data.movementCount} حركة`}</small>
        </header>

        <div className={`doctor-ledger ${filterBusy ? "is-loading" : ""}`} aria-busy={filterBusy}>
          <div className="doctor-ledger-period-opening">
            <div><strong>الرصيد السابق</strong><small>رصيد مرحّل من قبل الفترة المحددة</small></div>
            <b>{money(data.openingBalance)} <small>ج.م</small></b>
          </div>
          {data.ledger.days.map((day) => (
            <section className="doctor-ledger-day" key={day.date} aria-labelledby={`day-${day.date}`}>
              <header className="doctor-ledger-day__header">
                <div><span>يوم الحساب</span><h3 id={`day-${day.date}`}>{cairoDate(day.date)}</h3></div>
                <div className="doctor-ledger-day__opening"><span>رصيد أول اليوم</span><strong>{money(day.openingBalance)} <small>ج.م</small></strong></div>
              </header>
              <div className="doctor-ledger-day__movements">
                {day.movements.map((movement) => {
                  const state = movementStatus(movement);
                  const invalidContract = movement.type === "operation_posting" && !["lithotripsy", "endoscopy"].includes(movement.operationType ?? "");
                  const expanded = expandedSupplies.has(movement.id);
                  const visibleItems = expanded ? movement.supplyItems : movement.supplyItems.slice(0, 3);
                  return (
                    <article className={`doctor-ledger-movement ${state.className} ${invalidContract ? "is-integrity-error" : ""}`} key={`${movement.type}-${movement.id}`}>
                      <div className="doctor-ledger-movement__identity">
                        <time dateTime={movement.occurredAt}>{cairoTimeFormatter.format(new Date(movement.occurredAt))}</time>
                        <span>{movementTypeLabel(movement)}</span>
                        <strong>{state.label}</strong>
                      </div>
                      <div className="doctor-ledger-movement__context">
                        {invalidContract ? <p role="alert">خطأ سلامة بيانات: نوع العملية غير مؤهل لحساب الطبيب.</p> : <h4>{movement.caseName || movement.description}</h4>}
                        {movement.type === "operation_posting" && movement.doctorNameSnapshot && <small>الطبيب وقت الترحيل: {movement.doctorNameSnapshot}</small>}
                        {movement.notes && <p>{movement.notes}</p>}
                        {movement.type === "operation_posting" && movement.operationPostedAmount !== null && (
                          <div className="doctor-ledger-operation-money">
                            <div><span>القيمة المرجعية</span><strong>{movement.operationReferenceAmount === null ? "غير متاحة" : `${money(movement.operationReferenceAmount)} ج.م`}</strong></div>
                            <span className="doctor-ledger-operation-arrow" aria-hidden="true">←</span>
                            <div><span>المبلغ المرحّل</span><strong>{money(movement.operationPostedAmount)} ج.م</strong></div>
                            <div><span>الفرق</span><strong>{movement.operationDifferenceAmount === null ? "غير متاح" : `${money(movement.operationDifferenceAmount)} ج.م`}</strong></div>
                          </div>
                        )}
                        {movement.type === "supply_issue" && movement.supplyItems.length > 0 && (
                          <div className="doctor-ledger-supply-items">
                            {visibleItems.map((item) => <div className="doctor-ledger-supply-item" key={item.id}><div><strong>{item.name}</strong><span>{supplySourceLabels[item.sourceType]}</span></div><div className="doctor-ledger-supply-calculation"><span>{item.quantity} × {money(item.unitPrice)} ج.م</span><strong>{money(item.totalAmount)} ج.م</strong></div>{item.notes && <small>{item.notes}</small>}</div>)}
                            {movement.supplyItems.length > 3 && <button type="button" aria-expanded={expanded} onClick={() => setExpandedSupplies((current) => { const next = new Set(current); if (expanded) next.delete(movement.id); else next.add(movement.id); return next; })}>{expanded ? "عرض أقل" : `عرض كل المستلزمات (${movement.supplyItems.length})`}</button>}
                            <div className="doctor-ledger-supply-total"><span>إجمالي المستلزمات</span><strong>{money(movement.amount)} ج.م</strong></div>
                          </div>
                        )}
                        {movement.operationId && !invalidContract && (canViewOperations ? <Link href={`/operations#${movement.operationId}`}>فتح الحالة</Link> : <span className="doctor-ledger-operation-unavailable">فتح الحالة غير متاح لصلاحياتك</span>)}
                      </div>
                      <div className="doctor-ledger-movement__accounting">
                        <div><span>الحركة</span><strong className={state.className}>{state.sign}{money(movement.amount)} <small>ج.م</small></strong></div>
                        <div><span>الرصيد قبل الحركة</span><b>{money(movement.balanceBefore)} ج.م</b></div>
                        <div className="is-result"><span>الرصيد بعد الحركة</span><b>{money(movement.balanceAfter)} ج.م</b></div>
                      </div>
                    </article>
                  );
                })}
              </div>
              <footer className="doctor-ledger-day__footer">
                <div className="doctor-ledger-day__totals"><span>حركة اليوم</span><small>مضاف +{money(day.debitTotal)} · مسدد ومخصوم −{money(day.creditTotal)} · الصافي {day.netMovement > 0 ? "+" : ""}{money(day.netMovement)} ج.م</small></div>
                <div className="is-closing"><span>رصيد آخر اليوم</span><strong>{money(day.closingBalance)} ج.م</strong></div>
              </footer>
            </section>
          ))}

          {!data.ledger.days.length && (
            <div className="doctor-account-empty doctor-account-empty--quiet">
              <span className="doctor-account-empty__icon" aria-hidden="true">د</span>
              <h2>لا توجد حركات خلال هذه الفترة</h2>
              <p>الرصيد السابق والرصيد الختامي معروضان أعلاه حتى في الفترات الهادئة.</p>
              <strong>{money(data.closingBalance)} ج.م</strong>
            </div>
          )}
          <footer className="doctor-ledger-period-closing">
            <div><span>إجمالي المضاف خلال الفترة</span><strong>+{money(data.periodDebit)} ج.م</strong></div>
            <div><span>إجمالي المسدد والمخصوم</span><strong>−{money(data.periodCredit)} ج.م</strong></div>
            <div><span>صافي حركة الفترة</span><strong>{data.periodNetMovement > 0 ? "+" : ""}{money(data.periodNetMovement)} ج.م</strong></div>
            <div className="is-final"><span>الرصيد الختامي</span><strong>{money(data.closingBalance)} ج.م</strong><small>{closingState.label}</small></div>
          </footer>
        </div>
      </section>

      {mode && (
        <div
          className="doctor-account-dialog"
          role="dialog"
          aria-modal="true"
        >
          <button
            className="doctor-account-dialog__backdrop"
            aria-label="إغلاق"
            onClick={() => setMode(null)}
          />

          <section className="doctor-account-dialog__panel">
            <header>
              <div>
                <span>
                  {mode === "payment"
                    ? "تحصيل من الطبيب"
                    : "حركة يدوية"}
                </span>

                <h2>
                  {mode === "payment"
                    ? "تسجيل دفعة"
                    : "إضافة حركة على الحساب"}
                </h2>

                <p>{data.doctor.name}</p>
              </div>

              <button
                className="doctor-account-dialog__close"
                aria-label="إغلاق"
                onClick={() => setMode(null)}
              >
                ×
              </button>
            </header>

            <div className="doctor-account-dialog__body">
              {mode === "adjustment" && (
                <>
                  <label>
                    اتجاه الحركة

                    <select
                      value={direction}
                      onChange={(event) =>
                        setDirection(
                          event.target.value as
                            | "debit"
                            | "credit",
                        )
                      }
                    >
                      <option value="debit">
                        إضافة على حساب الطبيب
                      </option>

                      <option value="credit">
                        خصم / تسوية من الحساب
                      </option>
                    </select>
                  </label>

                  <label>
                    وصف الحركة

                    <input
                      value={description}
                      onChange={(event) =>
                        setDescription(event.target.value)
                      }
                      placeholder="مثال: فرق حساب حالة"
                    />
                  </label>
                </>
              )}

              <label>
                المبلغ

                <MoneyInput
                  value={amount}
                  onChange={setAmount}
                  ariaLabel="مبلغ الحركة"
                  placeholder="أدخل المبلغ"
                />
              </label>

              {mode === "payment" &&
                data.balance > 0 && (
                  <div className="doctor-payment-balance-hint">
                    <span>الرصيد المستحق حاليًا</span>

                    <strong>
                      {money(data.balance)} ج.م
                    </strong>
                  </div>
                )}

              <label>
                التاريخ والوقت

                <input
                  type="datetime-local"
                  value={date}
                  onChange={(event) =>
                    setDate(event.target.value)
                  }
                />
              </label>

              <label>
                ملاحظة اختيارية

                <textarea
                  value={notes}
                  onChange={(event) =>
                    setNotes(event.target.value)
                  }
                  placeholder="أي توضيح متعلق بالحركة..."
                  rows={3}
                />
              </label>

              {error && (
                <p className="form-error">{error}</p>
              )}
            </div>

            <footer>
              <button onClick={() => setMode(null)}>
                إلغاء
              </button>

              <button
                className="primary"
                disabled={
                  busy ||
                  !amount ||
                  Number(amount) <= 0 ||
                  (mode === "adjustment" &&
                    description.trim().length < 2)
                }
                onClick={() => void save()}
              >
                {busy ? "جارٍ الحفظ..." : "حفظ الحركة"}
              </button>
            </footer>
          </section>
        </div>
      )}
      {supplyOpen && (
        <div
          className="doctor-account-dialog doctor-supply-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="صرف مستلزمات للطبيب"
        >
          <button
            className="doctor-account-dialog__backdrop"
            aria-label="إغلاق"
            onClick={() => {
              if (!busy) setSupplyOpen(false);
            }}
          />

          <section className="doctor-account-dialog__panel doctor-supply-dialog__panel">
            <header>
              <div>
                <span>حساب الطبيب</span>
                <h2>صرف مستلزمات</h2>
                <p>{data.doctor.name}</p>
              </div>
              <button
                className="doctor-account-dialog__close"
                aria-label="إغلاق"
                disabled={busy}
                onClick={() => setSupplyOpen(false)}
              >
                ×
              </button>
            </header>

            <div className="doctor-account-dialog__body">
              <div className="doctor-supply-help">
                <strong>أضف ما تم تسليمه للطبيب</strong>
                <p>
                  اختر من البيانات المسجلة أو استخدم بندًا يدويًا. الإجمالي سيضاف تلقائيًا على حساب الطبيب.
                </p>
              </div>

              <div className="doctor-supply-lines">
                {supplyItems.map((item, index) => {
                  const catalog = supplyCatalogs[item.sourceType];
                  const lineTotal =
                    Number(item.quantity || 0) * Number(item.unitPrice || 0);

                  return (
                    <article className="doctor-supply-line" key={item.id}>
                      <header>
                        <strong>البند {index + 1}</strong>
                        <button
                          type="button"
                          className="doctor-supply-remove"
                          disabled={busy}
                          onClick={() => removeSupplyRow(item.id)}
                        >
                          إزالة
                        </button>
                      </header>

                      <div className="doctor-supply-line__grid">
                        <label>
                          نوع البند
                          <select
                            value={item.sourceType}
                            disabled={busy}
                            onChange={(event) =>
                              changeSupplySource(
                                item.id,
                                event.target.value as SupplySourceType,
                              )
                            }
                          >
                            <option value="consumable">مستلزم طبي</option>
                            <option value="stent">دعامة</option>
                            <option value="equipment">جهاز / أداة</option>
                            <option value="manual">بند يدوي</option>
                          </select>
                        </label>

                        {item.sourceType === "manual" ? (
                          <label>
                            اسم البند
                            <input
                              value={item.manualName}
                              disabled={busy}
                              placeholder="مثال: كرتونة محلول ملح"
                              onChange={(event) =>
                                updateSupplyItem(item.id, {
                                  manualName: event.target.value,
                                })
                              }
                            />
                          </label>
                        ) : (
                          catalog && (
                            <SmartSelect
                              label="اختيار البند"
                              type={catalog.type}
                              optionsEndpoint={catalog.endpoint}
                              value={item.sourceReferenceId}
                              canManage={canManageCatalogs}
                              onChange={(value) =>
                                updateSupplyItem(item.id, {
                                  sourceReferenceId: String(value),
                                })
                              }
                            />
                          )
                        )}

                        <label>
                          الكمية
                          <input
                            type="text"
                            inputMode="decimal"
                            value={item.quantity}
                            disabled={busy}
                            placeholder="1"
                            onChange={(event) =>
                              updateSupplyItem(item.id, {
                                quantity: event.target.value.replace(/[^0-9.]/g, ""),
                              })
                            }
                          />
                        </label>

                        <label>
                          سعر الوحدة
                          <MoneyInput
                            value={item.unitPrice}
                            disabled={busy}
                            ariaLabel={`سعر الوحدة للبند ${index + 1}`}
                            placeholder="أدخل السعر"
                            onChange={(value) =>
                              updateSupplyItem(item.id, {
                                unitPrice: value,
                              })
                            }
                          />
                        </label>
                      </div>

                      <div className="doctor-supply-line__total">
                        <span>إجمالي البند</span>
                        <strong>
                          {money(Number.isFinite(lineTotal) ? lineTotal : 0)} ج.م
                        </strong>
                      </div>

                      <label className="doctor-supply-line__notes">
                        ملاحظة على البند
                        <input
                          value={item.notes}
                          disabled={busy}
                          placeholder="اختياري..."
                          onChange={(event) =>
                            updateSupplyItem(item.id, {
                              notes: event.target.value,
                            })
                          }
                        />
                      </label>
                    </article>
                  );
                })}
              </div>

              <button
                type="button"
                className="doctor-supply-add-line"
                disabled={busy}
                onClick={addSupplyRow}
              >
                + إضافة بند آخر
              </button>

              <section className="doctor-supply-summary">
                <div>
                  <span>عدد البنود</span>
                  <strong>{supplyItems.length}</strong>
                </div>

                <div className="doctor-supply-summary__total">
                  <span>إجمالي حركة الصرف</span>
                  <strong>
                    {money(supplyTotal)}
                    <small> ج.م</small>
                  </strong>
                </div>
              </section>

              <label>
                التاريخ والوقت
                <input
                  type="datetime-local"
                  value={supplyDate}
                  disabled={busy}
                  onChange={(event) => setSupplyDate(event.target.value)}
                />
              </label>

              <label>
                ملاحظة عامة
                <textarea
                  value={supplyNotes}
                  disabled={busy}
                  rows={3}
                  placeholder="مثال: تم تسليم المستلزمات لمندوب الطبيب..."
                  onChange={(event) => setSupplyNotes(event.target.value)}
                />
              </label>

              {error && <p className="form-error">{error}</p>}
            </div>

            <footer>
              <button disabled={busy} onClick={() => setSupplyOpen(false)}>
                إلغاء
              </button>
              <button
                className="primary"
                disabled={busy || supplyItems.length === 0 || supplyTotal <= 0}
                onClick={() => void saveSupplyIssue()}
              >
                {busy
                  ? "جارٍ الحفظ..."
                  : "إضافة المستلزمات للحساب"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
