/* eslint-disable react-hooks/set-state-in-effect */
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CompactMonthFilter } from "@/components/pagination/compact-month-filter";
import { BottomPagination } from "@/components/pagination/bottom-pagination";
import { useRouter, useSearchParams } from "next/navigation";
import { monthlyPageSize, canonicalReviewQuery, isSupportedMonth, reviewCustomQuery, reviewMonthQuery, reviewPageCorrection, updateReviewQuery, type CalendarMonth } from "@/lib/pagination/monthly";
import { useDialogScrollLock } from "@/components/settings/users/use-dialog-scroll-lock";
import { SmartSelect } from "@/components/operations/smart-select";
import { FinancialTableBuilder } from "./financial-table-builder";
import { LithotripsySimpleReviewEditor } from "./simple-lithotripsy-review-editor-v2";
import { groupFinancialReview } from "@/lib/accounting/financial-review-grouping";
type WorkType = "lithotripsy" | "endoscopy" | "contract";
type Row = {
  id: string;
  type: WorkType;
  operationDate: string;
  dailySequence: number;
  operationTime: string;
  caseName: string;
  doctorId?: string;
  doctorName?: string;
  hospitalId?: string;
  hospitalName?: string;
  anesthesiologistName?: string;
  technicianName?: string;
  contractEntityName?: string;
  employeeName?: string;
  procedures?: string;
  equipment?: string;
  consumables?: string;
  stents?: string;
  side?: string;
  anesthesiaType?: string;
  sessionCount?: number;
  referenceNumber?: string;
  operationalAmountReceived?: number;
  reviewStatus: string;
  mainAmount: number;
  totalItems: number;
  additionTotal?: number;
  deductionTotal?: number;
  totalCosts?: number;
  finalBalance?: number;
  definitionValues?: Record<string, number>;
  doctorAccountAmount: number;
  paid: number;
  remaining: number;
  posted: boolean;
};
type Item = {
  id?: string;
  kind: "financial" | "note";
  description: string;
  amount: string | null;
  financialEffect: "add" | "subtract" | "neutral";
  sourceType:
    | "dynamic_field"
    | "anesthesiologist"
    | "technician"
    | "procedure"
    | "equipment"
    | "consumable"
    | "stent"
    | "manual"
    | "other";
  sourceFieldId: string | null;
  sourceReferenceId: string | null;
  definitionId?: string | null;
  baseAmount?: string | null;
  adjustmentAmount?: string | null;
  effectiveAmount?: string | null;
  caseLineState?: "included" | "excluded";
  servicePricingProfileId?: string | null;
  servicePricingItemId?: string | null;
  servicePricingVersion?: number | null;
  notes: string | null;
};
type ReviewData = {
  operation: Row;
  template: { id: string; name: string; version: number };
  context: Array<{
    fieldId: string;
    stableKey: string;
    label: string;
    display: string | string[];
    isFinancial: boolean;
    financialEffect: string | null;
    operationalValue: string | null;
  }>;
  suggestions: Array<Item & { operationalValue?: string | null }>;
  operationalCostSources: Array<{ sourceType: string; sourceId: string | null; sourceFieldId: string | null; sourceReferenceId: string | null; label: string; contextLabel: string; defaultEffect: "add"|"subtract"|"neutral"; defaultAmount?: number | null; pricingOrigin?: string }>;
  pricingDefaults?: Array<{ source: { sourceType: string; sourceId: string | null; sourceFieldId: string | null; sourceReferenceId: string | null; label: string; contextLabel: string; defaultEffect: "add"|"subtract"|"neutral" } | null; definitionId: string; stableKey: string; label: string; defaultAmount: number | null; effect: "add"|"subtract"|"neutral"; pricingOrigin: string; layoutStableKey?: string; servicePricingProfileId?: string|null; servicePricingItemId?: string|null; servicePricingVersion?: number|null }>;
  servicePricingProfile?: { id:string|null; name:string|null; version:number|null; hospitalId:string|null; warning:string|null; matchType?:string };
  orphanedItems?: Array<{ id: string; description: string; amount: string | null; sourceType: string }>;
  review: {
    id: string | null;
    status: string;
    mainAmount: number;
    doctorAccountAmount: number;
    doctorBalanceReceived: boolean;
    notes: string | null;
    updatedAt: string | null;
    items: Item[];
    payments: Array<{ id: string; amount: string; paidAt: string }>;
    totalItems: number;
    paid: number;
    remaining: number;
    posted: boolean;
    financialSummary?: { mainAmount: number; additionTotal: number; deductionTotal: number; finalBalance: number };
  };
  posting?: { id: string; amount: number; direction: "debit" | "credit"; signedAmount: number; postedAt: string } | null;
};
type LayoutColumn = { id: string; stableKey: string; label: string; kind: "system"|"operation_field"|"accountant_input"|"calculated"; sourceFieldStableKey: string|null; effect: "add"|"subtract"|"neutral"; visible: boolean; width: string; protected: boolean };
const labels: Record<WorkType, string> = {
    lithotripsy: "التفتيت",
    endoscopy: "المناظير",
    contract: "التعاقد",
  },
  statusLabels: Record<string, string> = {
    awaiting_review: "بانتظار المراجعة",
    reviewed: "تمت المراجعة",
    partially_paid: "مدفوع جزئياً",
    paid: "مدفوع",
  };
export function FinancialReviewWorkbench({
  defaultMonth,
  canEdit,
  canPay,
  canPost,
  canManageLayout,
}: {
  defaultMonth: CalendarMonth;
  canEdit: boolean;
  canPay: boolean;
  canPost: boolean;
  canManageLayout: boolean;
}) {
  const params = useSearchParams(), queryString = params.toString();
  const type = (params.get("type") || "lithotripsy") as WorkType;
  const date = params.get("date") || "", doctor = params.get("doctorId") || "", hospital = params.get("hospitalId") || "", status = params.get("reviewStatus") || "", search = params.get("search") || "";
  const [rows, setRows] = useState<Row[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [editing, setEditing] = useState<string | null>(null),
    [layout, setLayout] = useState<LayoutColumn[]>([]),
    [operationFields, setOperationFields] = useState<Array<{ stableKey: string; label: string }>>([]),
    [builderOpen, setBuilderOpen] = useState(false),
    [view, setView] = useState<"grouped" | "table">("grouped"),
    [filtersOpen, setFiltersOpen] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 0, hasNext: false, hasPrevious: false });
  const [range, setRange] = useState({ from: "", to: "" });
  const [dateDraft, setDateDraft] = useState<{ query: string; from: string; to: string } | null>(null);
  const activeDraft = dateDraft?.query === queryString ? dateDraft : null;
  const from = activeDraft?.from ?? params.get("from") ?? range.from, to = activeDraft?.to ?? params.get("to") ?? range.to;
  const anchor = (params.get("from") || date).split("-").map(Number);
  const candidate = { year: Number(params.get("year")) || anchor[0] || defaultMonth.year, month: Number(params.get("month")) || anchor[1] || defaultMonth.month };
  const selectedMonth = isSupportedMonth(candidate) ? candidate : defaultMonth;
  const writeQuery = (query: string) => window.history.replaceState(null, "", `?${query}${window.location.hash}`);
  const update = (changes: Record<string, string>) => writeQuery(canonicalReviewQuery(updateReviewQuery(window.location.search, changes), defaultMonth));
  const navigateMonth = (month: CalendarMonth) => { if (isSupportedMonth(month)) { setDateDraft(null); writeQuery(reviewMonthQuery(window.location.search, month)); } };
  const changeRange = (key: "from" | "to", value: string) => {
    const next = { from, to, [key]: value };
    setDateDraft({ query: queryString, ...next });
    if (next.from && next.to && next.from <= next.to) { writeQuery(reviewCustomQuery(window.location.search, next.from, next.to)); setDateDraft(null); }
  };
  const changeDate = (value: string) => { setDateDraft(null); if (value) update({ date: value, period: "", year: "", month: "", from: "", to: "" }); else navigateMonth(selectedMonth); };
  const layoutGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const requestGenerationRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const loadLayout = useCallback(async (signal?: AbortSignal) => {
    const generation = ++layoutGenerationRef.current;
    try {
      const response = await fetch(`/api/v1/financial-reviews/layout/${type}`, { cache: "no-store", signal });
      const body = await response.json().catch(() => ({}));
      if (response.ok && mountedRef.current && !signal?.aborted && generation === layoutGenerationRef.current && (new URLSearchParams(window.location.search).get("type") || "lithotripsy") === type) {
        setLayout(Array.isArray(body.layout) ? body.layout : []);
        setOperationFields(Array.isArray(body.operationFields) ? body.operationFields : []);
      }
    } catch {
      // Layout configuration is optional; it must never block the case list.
      if (mountedRef.current && !signal?.aborted && generation === layoutGenerationRef.current) {
        setLayout([]);
        setOperationFields([]);
      }
    }
  }, [type, setLayout, setOperationFields]);
  const load = useCallback(async (signal?: AbortSignal) => {
    const requestGeneration = ++requestGenerationRef.current;
    setLoading(true);
    setError("");
    const currentRequest = () => mountedRef.current && !signal?.aborted && requestGeneration === requestGenerationRef.current && new URLSearchParams(window.location.search).toString() === queryString;
    try {
      const response = await fetch(`/api/v1/financial-reviews?${queryString}`, { cache: "no-store", signal });
      const body = await response.json().catch(() => ({}));
      if (!currentRequest()) return;
      if (!response.ok) throw new Error(body.error?.message ?? "تعذر تحميل المراجعات.");
      const correction = reviewPageCorrection(queryString, body.pagination);
      if (correction) { window.history.replaceState(null, "", `?${correction}${window.location.hash}`); return; }
      setRows(Array.isArray(body.operations) ? body.operations : []);
      setPagination(body.pagination);
      setRange({ from: body.filters.from || "", to: body.filters.to || "" });
    } catch (caught) {
      if (!currentRequest()) return;
      setRows([]);
      setError(caught instanceof Error ? caught.message : "تعذر تحميل المراجعات.");
    } finally {
      if (mountedRef.current && !signal?.aborted && requestGeneration === requestGenerationRef.current) setLoading(false);
    }
  }, [queryString, setLoading, setError, setRows, setPagination, setRange]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    const controller = new AbortController();
    void loadLayout(controller.signal);
    return () => controller.abort();
  }, [loadLayout]);
  return (
    <div className="review-page">
      <header className="operations-hero">
        <div>
          <span>الحسابات</span>
          <h2>مراجعة الشغل</h2>
          <p>سياق تشغيلي تاريخي وقيم محاسبية معتمدة ومنفصلة عن إدخال الموظف.</p>
        </div>
      </header>
      <div className="operation-segments">
        {Object.entries(labels).map(([id, label]) => (
          <button
            key={id}
            className={type === id ? "active" : ""}
            onClick={() => update({ type: id })}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="financial-review-toolbar">
        <CompactMonthFilter year={selectedMonth.year} month={selectedMonth.month} monthlyScope={params.get("period")==="month"} onMonthChange={navigateMonth}/>
        <div className="financial-review-view-toggle" role="group" aria-label="طريقة العرض">
          <button className={view === "grouped" ? "active" : ""} onClick={() => setView("grouped")}>العرض المجمع</button>
          <button className={view === "table" ? "active" : ""} onClick={() => setView("table")}>الجدول</button>
        </div>
        <button className="financial-review-filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((current) => !current)}>الفلاتر</button>
        <div className="financial-review-secondary-actions">
          <Link href={`/accounts/review/${type}/pricing`}>فتح مكتبة الأسعار</Link>
          {canManageLayout && view === "table" && <button onClick={() => setBuilderOpen(true)}>⚙ إعدادات الجدول</button>}
        </div>
      </div>
      <section className={`operation-filters review-filters ${filtersOpen ? "is-open" : ""}`}>
        <div className="operation-grid">
          <label>
            بحث
            <input
              value={search}
              onChange={(event) => update({ search: event.target.value })}
              placeholder="الحالة أو الرقم المرجعي"
            />
          </label>
          <label>
            تاريخ محدد
            <input
              type="date"
              value={date}
              onChange={(event) => changeDate(event.target.value)}
            />
          </label>
          <label>
            من
            <input
              type="date"
              disabled={loading}
              value={from}
              onChange={(event) => changeRange("from", event.target.value)}
            />
          </label>
          <label>
            إلى
            <input
              type="date"
              disabled={loading}
              value={to}
              onChange={(event) => changeRange("to", event.target.value)}
            />
          </label>
          <SmartSelect
            label="الطبيب"
            type="doctors"
            value={doctor}
            onChange={(value) => update({ doctorId: value as string })}
            canManage={false}
          />
          <SmartSelect
            label="المستشفى"
            type="hospitals"
            value={hospital}
            onChange={(value) => update({ hospitalId: value as string })}
            canManage={false}
          />
          <label>
            حالة المراجعة
            <select
              value={status}
              onChange={(event) => update({ reviewStatus: event.target.value })}
            >
              <option value="">الكل</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {activeDraft && <small role="status">{!from || !to ? "أكمل بداية ونهاية الفترة لتطبيقها." : "نهاية الفترة يجب ألا تسبق بدايتها."}</small>}
      </section>
      {loading ? (
        <p className="operations-state">جاري تحميل المراجعة...</p>
      ) : error ? (
        <p className="operations-state error">{error} <button type="button" onClick={() => void load()}>إعادة المحاولة</button></p>
      ) : !rows.length ? (
        <p className="operations-state">لا توجد حالات مطابقة للمراجعة.</p>
      ) : (
        view === "grouped" ? <GroupedFinancialReview type={type} rows={rows} onOpen={setEditing} /> : <ReviewTable type={type} rows={rows} onOpen={setEditing} layout={layout} />
      )}
      <BottomPagination page={Number(params.get("page")) || 1} pageSize={monthlyPageSize(params.get("pageSize"))} total={pagination.total} totalPages={pagination.totalPages} hasNext={pagination.hasNext} hasPrevious={pagination.hasPrevious} loading={loading} monthlyScope={params.get("period")==="month"} onPageChange={page=>update({page:String(page)})} onPageSizeChange={size=>update({pageSize:String(size)})}/>
      {editing && (
        type === "lithotripsy" ? <LithotripsySimpleReviewEditor
          operationId={editing}
          canEdit={canEdit}
          canPost={canPost}
          onClose={() => setEditing(null)}
          onChanged={() => void load()}
        /> : <ReviewEditor
          operationId={editing}
          canEdit={canEdit}
          canPay={canPay}
          canPost={canPost}
          layout={layout}
          onClose={() => setEditing(null)}
          onChanged={() => void load()}
        />
      )}
      {builderOpen && <FinancialTableBuilder type={type} initial={layout} sources={operationFields} onClose={() => setBuilderOpen(false)} onSaved={() => void loadLayout()} />}
    </div>
  );
}
const reviewDayFormatter = new Intl.DateTimeFormat("ar-EG", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Cairo" });
const reviewMoney = (value: number) => `${Object.is(value, -0) ? "0" : value.toLocaleString("en-US", { maximumFractionDigits: 2 })} ج.م`;
const reviewCount = (count: number) => count === 1 ? "حالة واحدة" : count === 2 ? "حالتان" : `${count} حالات`;
function GroupedFinancialReview({ type, rows, onOpen }: { type: WorkType; rows: Row[]; onOpen: (id: string) => void }) {
  const days = useMemo(() => groupFinancialReview(rows, type), [rows, type]);
  return <div className="financial-review-days">{days.map((day) => <section className="financial-review-day" key={day.date}><header><div><small>يوم المراجعة</small><h3>{reviewDayFormatter.format(new Date(`${day.date}T12:00:00Z`))}</h3></div><strong>{reviewCount(day.casesCount)} {labels[type]}</strong></header><div className="financial-review-groups">{day.groups.map((group) => <section className="financial-review-group" key={group.key}><header><div><small>{type === "contract" ? "المستشفى" : "الطبيب"}</small><h4>{type === "contract" ? group.label : `د. ${group.label.replace(/^د\.\s*/, "")}`}</h4></div><span>{reviewCount(group.cases.length)}</span></header><div className="financial-review-card-grid">{group.cases.map((row) => <FinancialReviewCase key={row.id} row={row} onOpen={onOpen} />)}</div></section>)}</div></section>)}</div>;
}
function FinancialReviewCase({ row, onOpen }: { row: Row; onOpen: (id: string) => void }) {
  const side = row.side === "right" ? "يمين" : row.side === "left" ? "يسار" : row.side === "bilateral" ? "الجانبان" : null;
  const operational = [row.procedures, row.equipment].filter(Boolean).join(" • ");
  return <article className="financial-review-case"><header className="financial-review-case__title"><div><small>{row.type === "contract" ? row.contractEntityName || "جهة تعاقد غير محددة" : row.doctorName || "بدون طبيب"}</small><h5>{row.caseName?.trim() || "بدون اسم حالة"}</h5></div><span className={`review-status ${row.reviewStatus}`}>{statusLabels[row.reviewStatus] ?? row.reviewStatus}</span></header><div className="financial-review-case__identity"><strong>{row.hospitalName || "بدون مستشفى محدد"}</strong><span>{row.operationDate} · <bdi>{row.operationTime}</bdi></span>{row.type === "contract" && row.referenceNumber && <span>الرقم الموحد: {row.referenceNumber}</span>}</div><div className="financial-review-case__context">{operational && <p>{operational}</p>}<div className="financial-review-case__meta">{side && <span>{side}</span>}{row.sessionCount != null && <span>{row.sessionCount === 1 ? "جلسة واحدة" : row.sessionCount === 2 ? "جلستان" : `${row.sessionCount} جلسات`}</span>}{row.anesthesiaType && <span>{row.anesthesiaType}</span>}{row.anesthesiologistName && <span>التخدير: {row.anesthesiologistName}</span>}{row.technicianName && <span>الفني: {row.technicianName}</span>}{row.type === "endoscopy" && row.employeeName && <span>الموظف: {row.employeeName}</span>}{row.type === "contract" && row.doctorName && <span>الطبيب: {row.doctorName}</span>}</div></div><section className="financial-review-case__money" aria-label="الملخص المالي">{row.type !== "contract" && <div><span>المبلغ الرئيسي</span><b>{reviewMoney(row.mainAmount)}</b></div>}<div><span>{row.type === "contract" ? "إجمالي البنود" : "البنود / التكاليف"}</span><b>{reviewMoney(row.type === "contract" ? row.totalItems : (row.totalCosts ?? 0))}</b></div><div className="primary"><span>{row.type === "contract" ? "القيمة التعاقدية" : "الرصيد النهائي"}</span><b>{reviewMoney(row.type === "contract" ? row.doctorAccountAmount : (row.finalBalance ?? 0))}</b></div></section>{row.type !== "contract" && <p className="financial-review-case__settlement">المدفوع {reviewMoney(row.paid)} · المتبقي {reviewMoney(row.remaining)}{row.posted ? " · تم الترحيل لحساب الطبيب" : ""}</p>}<footer className="financial-review-case__actions"><button type="button" className="primary" onClick={() => onOpen(row.id)}>مراجعة البنود</button><a href={`/operations#${row.id}`}>فتح الحالة</a></footer></article>;
}
function ReviewTable({
  type,
  rows,
  onOpen,
  layout = [],
}: {
  type: WorkType;
  rows: Row[];
  onOpen: (id: string) => void;
  layout?: LayoutColumn[];
}) {
  if (layout.length) return <ConfiguredReviewTable rows={rows} columns={layout} onOpen={onOpen} />;
  return (
    <div className="review-table-wrap">
      <table className="review-table dynamic-review-table">
        <thead>
          <tr>
            <th>م</th>
            <th>اليوم</th>
            <th>التاريخ</th>
            <th>الطبيب</th>
            <th>اسم الحالة</th>
            <th>المستشفى</th>
            {type === "lithotripsy" && (
              <>
                <th>الإجراءات</th>
                <th>الاتجاه</th>
                <th>التخدير</th>
                <th>طبيب التخدير</th>
                <th>الفني</th>
                <th>الجلسات</th>
              </>
            )}
            {type === "endoscopy" && (
              <>
                <th>الأجهزة</th>
                <th>الموظف</th>
                <th>المستلم تشغيلياً</th>
              </>
            )}
            {type === "contract" && (
              <>
                <th>المرجع</th>
                <th>جهة التعاقد</th>
                <th>الإجراء / الجهاز</th>
              </>
            )}
            {type === "contract" ? <><th>إجمالي البنود</th><th>القيمة التعاقدية</th></> : <><th>الرئيسي</th><th>إجمالي البنود</th><th>حساب الطبيب</th><th>المدفوع</th><th>المتبقي</th></>}
            <th>الحالة</th>
            <th>الإجراءات</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>#{row.dailySequence}</td>
              <td>
                {new Intl.DateTimeFormat("ar-EG", { weekday: "short" }).format(
                  new Date(`${row.operationDate}T12:00:00`),
                )}
              </td>
              <td>{row.operationDate}</td>
              <td>{row.doctorName || "—"}</td>
              <td>{row.caseName}</td>
              <td>{row.hospitalName || "—"}</td>
              {type === "lithotripsy" && (
                <>
                  <td>{row.procedures || "—"}</td>
                  <td>{row.side || "—"}</td>
                  <td>{row.anesthesiaType || "—"}</td>
                  <td>{row.anesthesiologistName || "—"}</td>
                  <td>{row.technicianName || "—"}</td>
                  <td>{row.sessionCount || 1}</td>
                </>
              )}
              {type === "endoscopy" && (
                <>
                  <td>{row.equipment || "—"}</td>
                  <td>{row.employeeName || "—"}</td>
                  <td>{row.operationalAmountReceived ?? "—"}</td>
                </>
              )}
              {type === "contract" && (
                <>
                  <td>{row.referenceNumber || "—"}</td>
                  <td>{row.contractEntityName || "—"}</td>
                  <td>
                    {[row.procedures, row.equipment]
                      .filter(Boolean)
                      .join("، ") || "—"}
                  </td>
                </>
              )}
              {type === "contract" ? <><td>{Math.abs(row.totalItems).toFixed(2)}</td><td>{row.doctorAccountAmount.toFixed(2)}</td></> : <><td>{row.mainAmount.toFixed(2)}</td><td>{row.totalItems.toFixed(2)}</td><td>{row.doctorAccountAmount.toFixed(2)}</td><td>{row.paid.toFixed(2)}</td><td>{row.remaining.toFixed(2)}</td></>}
              <td>
                <span className={`review-status ${row.reviewStatus}`}>
                  {statusLabels[row.reviewStatus]}
                </span>
              </td>
              <td>
                <button onClick={() => onOpen(row.id)}>مراجعة / البنود</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function configuredValue(row: Row, column: LayoutColumn, index: number) {
  if (column.stableKey === "row_number") return index + 1;
  if (column.stableKey === "day") return new Intl.DateTimeFormat("ar-EG", { weekday: "long" }).format(new Date(`${row.operationDate}T12:00:00`));
  if (column.kind === "accountant_input" && column.stableKey !== "main_amount") { const value = row.definitionValues?.[column.id]; return value == null ? "—" : Number(value).toFixed(2); }
  const values: Record<string, unknown> = {
    operation_date: row.operationDate, doctor: row.doctorName, hospital: row.hospitalName, case_name: row.caseName,
    procedures: row.procedures, equipment: row.equipment, consumables: row.consumables, stents: row.stents, side: row.side, anesthesia_type: row.anesthesiaType,
    anesthesiologist: row.anesthesiologistName, technician: row.technicianName, session_count: row.sessionCount == null ? null : row.sessionCount === 1 ? "الجلسة الأولى" : row.sessionCount === 2 ? "الجلسة الثانية" : `الجلسة رقم ${row.sessionCount}`,
    reference_number: row.referenceNumber, contract_entity: row.contractEntityName, main_amount: row.mainAmount,
    addition_total: row.additionTotal ?? 0, deduction_total: row.deductionTotal ?? 0,
    total_costs: row.totalCosts ?? row.deductionTotal ?? 0, final_balance: row.finalBalance ?? 0,
  };
  const value = values[column.sourceFieldStableKey ?? column.stableKey];
  return value == null || value === "" ? "—" : typeof value === "number" ? value.toFixed(2) : String(value);
}
function ConfiguredReviewTable({ rows, columns, onOpen }: { rows: Row[]; columns: LayoutColumn[]; onOpen: (id: string) => void }) {
  const visible = columns.filter((column) => column.visible);
  return <div className="review-table-wrap"><table className="review-table dynamic-review-table"><thead><tr>{visible.map((column) => <th key={column.id} data-width={column.width}>{column.label}</th>)}<th>الإجراءات</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id}>{visible.map((column) => <td key={column.id}>{configuredValue(row, column, index)}</td>)}<td><button onClick={() => onOpen(row.id)}>مراجعة / البنود</button></td></tr>)}</tbody></table></div>;
}
function ReviewEditor({
  operationId,
  canEdit,
  canPay,
  canPost,
  layout,
  onClose,
  onChanged,
}: {
  operationId: string;
  canEdit: boolean;
  canPay: boolean;
  canPost: boolean;
  layout: LayoutColumn[];
  onClose: () => void;
  onChanged: () => void;
}) {
  useDialogScrollLock(true, false);
  const router = useRouter();
  const [data, setData] = useState<ReviewData | null>(null),
    [main, setMain] = useState("0.00"),
    [notes, setNotes] = useState(""),
    [items, setItems] = useState<Item[]>([]),
    [costPrices, setCostPrices] = useState<Record<string, string>>({}),
    [definitionPrices, setDefinitionPrices] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const [initialState, setInitialState] = useState<string | null>(null);
  const settlementActionRef = useRef(false);
  const load = useCallback(async () => {
    const response = await fetch(
        `/api/v1/operations/${operationId}/financial-review`,
        { cache: "no-store" },
      ),
      body = await response.json();
    if (!response.ok) {
      setError(body.error?.message ?? "تعذر تحميل المراجعة.");
      return null;
    }
    const authoritative = body as ReviewData;
    setData(authoritative);
    setMain(Number(body.review.mainAmount).toFixed(2));
    setNotes(body.review.notes ?? "");
    const fixedDefaults: Item[] = body.review.id ? [] : ((body.pricingDefaults ?? []) as NonNullable<ReviewData["pricingDefaults"]>).filter((price) => !price.source && price.servicePricingItemId).map((price) => ({ kind:"financial",description:price.label,amount:price.defaultAmount==null?null:String(price.defaultAmount),baseAmount:price.defaultAmount==null?null:String(price.defaultAmount),adjustmentAmount:"0.00",effectiveAmount:price.defaultAmount==null?null:String(price.defaultAmount),caseLineState:"included",financialEffect:price.effect,sourceType:"manual",sourceFieldId:null,sourceReferenceId:null,definitionId:null,servicePricingProfileId:price.servicePricingProfileId,servicePricingItemId:price.servicePricingItemId,servicePricingVersion:price.servicePricingVersion,notes:"بند ثابت من قائمة الأسعار" }));
    setItems([...(body.review.items as Item[]), ...fixedDefaults]);
    const sourceValues: Record<string, string> = {}, definitionValues: Record<string, string> = {};
    for (const item of body.review.items as Item[]) {
      if (item.sourceType !== "manual" && item.sourceType !== "other") sourceValues[`${item.sourceType}:${item.sourceFieldId ?? ""}:${item.sourceReferenceId ?? ""}`] = item.amount ?? "";
      if (item.definitionId) definitionValues[item.definitionId] = item.amount ?? "";
    }
    for (const price of (body.pricingDefaults ?? []) as NonNullable<ReviewData["pricingDefaults"]>) {
      if (price.source) {
        const key = `${price.source.sourceType}:${price.source.sourceFieldId ?? ""}:${price.source.sourceReferenceId ?? ""}`;
        if (sourceValues[key] == null && price.defaultAmount != null) sourceValues[key] = String(price.defaultAmount);
      } else if (price.layoutStableKey && price.defaultAmount != null) {
        const column = layout.find((item) => item.stableKey === price.layoutStableKey && item.kind === "accountant_input");
        if (column && definitionValues[column.id] == null) definitionValues[column.id] = String(price.defaultAmount);
      }
    }
    setCostPrices(sourceValues); setDefinitionPrices(definitionValues);
    setInitialState(JSON.stringify({ main: Number(body.review.mainAmount).toFixed(2), notes: body.review.notes ?? "", items: [...body.review.items, ...fixedDefaults], costPrices: sourceValues, definitionPrices: definitionValues }));
    return authoritative;
  }, [operationId, layout]);
  useEffect(() => {
    void load();
  }, [load]);
  const liveSummary = useMemo(() => {
    let addition = 0, deduction = 0;
    const apply = (amount: string | number | null | undefined, effect: Item["financialEffect"]) => { const cents = Math.round(Number(amount || 0) * 100); if (effect === "add") addition += cents; else if (effect === "subtract") deduction += cents; };
    for (const source of data?.operationalCostSources ?? []) apply(costPrices[`${source.sourceType}:${source.sourceFieldId ?? ""}:${source.sourceReferenceId ?? ""}`], source.defaultEffect);
    for (const column of layout.filter((item) => item.kind === "accountant_input" && item.stableKey !== "main_amount" && item.visible)) apply(definitionPrices[column.id], column.effect);
    for (const item of items.filter((item) => (item.sourceType === "manual" || item.sourceType === "other") && !item.definitionId)) apply(item.amount, item.financialEffect);
    for (const item of data?.orphanedItems ?? []) apply(item.amount, "subtract");
    const directItems = data?.operation.type === "contract" || data?.operation.type === "endoscopy";
    return { additionTotal: addition / 100, deductionTotal: deduction / 100, totalCosts: deduction / 100, finalBalance: directItems ? (addition + deduction) / 100 : Number(main || 0) + (addition - deduction) / 100 };
  }, [data, costPrices, definitionPrices, items, layout, main]);
  const dirty = initialState != null && initialState !== JSON.stringify({ main, notes, items, costPrices, definitionPrices });
  const settlementPreview = Math.round((liveSummary.finalBalance - (data?.review.paid ?? 0)) * 100) / 100;
  const displayedSettlement = dirty ? settlementPreview : (data?.review.remaining ?? 0);
  function addSuggestion(s: ReviewData["suggestions"][number]) {
    setItems((c) => [
      ...c,
      {
        kind: "financial",
        description: s.description,
        amount: "0.00",
        financialEffect: s.financialEffect,
        sourceType: s.sourceType,
        sourceFieldId: s.sourceFieldId,
        sourceReferenceId: s.sourceReferenceId,
        notes: s.operationalValue
          ? `القيمة التشغيلية المسجلة: ${s.operationalValue}`
          : null,
      },
    ]);
  }
  function addManual(kind: "financial" | "note") {
    setItems((c) => [
      ...c,
      {
        kind,
        description: "",
        amount: kind === "financial" ? "0.00" : null,
        financialEffect: kind === "financial" ? "subtract" : "neutral",
        sourceType: "manual",
        sourceFieldId: null,
        sourceReferenceId: null,
        notes: null,
      },
    ]);
  }
  function updateItem(index: number, patch: Partial<Item>) {
    setItems((c) =>
      c.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }
  async function save(announce = true): Promise<ReviewData | null> {
    if (!data || busy) return null;
    const existingSourceKeys = new Set(items.filter((item) => item.sourceType !== "manual" && item.sourceType !== "other").map((item) => `${item.sourceType}:${item.sourceFieldId ?? ""}:${item.sourceReferenceId ?? ""}`));
    const pricedSources = data.operationalCostSources
      .map((source) => ({ source, amount: costPrices[`${source.sourceType}:${source.sourceFieldId ?? ""}:${source.sourceReferenceId ?? ""}`] ?? "" }))
      .filter((entry) => entry.amount.trim() !== "" && !existingSourceKeys.has(`${entry.source.sourceType}:${entry.source.sourceFieldId ?? ""}:${entry.source.sourceReferenceId ?? ""}`))
      .map(({ source, amount }) => { const price=data.pricingDefaults?.find(candidate=>candidate.source?.sourceType===source.sourceType&&candidate.source?.sourceReferenceId===source.sourceReferenceId);const base=price?.defaultAmount??null;return { kind: "financial" as const, definitionId: null, description: `${source.contextLabel} — ${source.label}`, amount, baseAmount:base==null?null:String(base),adjustmentAmount:base==null?null:(Number(amount)-base).toFixed(2),effectiveAmount:amount,caseLineState:"included" as const, financialEffect: price?.effect??source.defaultEffect, sourceType: source.sourceType as Item["sourceType"], sourceFieldId: source.sourceFieldId, sourceReferenceId: source.sourceReferenceId,servicePricingProfileId:price?.servicePricingProfileId??null,servicePricingItemId:price?.servicePricingItemId??null,servicePricingVersion:price?.servicePricingVersion??null, notes: "مصدر تشغيلي مسجل" };});
    const configuredDefinitions: Item[] = layout.filter((column) => column.kind === "accountant_input" && column.stableKey !== "main_amount" && column.id)
      .map((column) => ({ column, amount: definitionPrices[column.id] ?? "" })).filter((entry) => entry.amount.trim() !== "")
      .map(({ column, amount }) => ({ kind: "financial" as const, definitionId: column.id, description: column.label, amount, financialEffect: column.effect, sourceType: "other" as const, sourceFieldId: null, sourceReferenceId: null, notes: "إدخال محاسبي من إعداد الجدول" }));
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(
        `/api/v1/operations/${operationId}/financial-review`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedUpdatedAt: data.review.updatedAt,
            accountingMode: data.operation.type === "lithotripsy" ? "main_amount" : "direct_items",
            mainAmount: data.operation.type === "lithotripsy" ? main : null,
            doctorAccountAmount: null,
            doctorBalanceReceived: data.review.doctorBalanceReceived,
            notes: notes || null,
            items: ([...items.filter((item) => !item.definitionId).map((item) => item.sourceType !== "manual" && item.sourceType !== "other" ? { ...item, amount: costPrices[`${item.sourceType}:${item.sourceFieldId ?? ""}:${item.sourceReferenceId ?? ""}`] ?? item.amount } : item), ...pricedSources, ...configuredDefinitions] as Item[])
              .filter((i) => i.description.trim())
              .map((item) => ({
                kind: item.kind,
                description: item.description,
                amount: item.amount,
                financialEffect: item.financialEffect,
                sourceType: item.sourceType,
                sourceFieldId: item.sourceFieldId,
                sourceReferenceId: item.sourceReferenceId,
                definitionId: item.definitionId ?? null,
                baseAmount: item.baseAmount ?? null,
                adjustmentAmount: item.baseAmount != null && item.amount != null ? (Number(item.amount)-Number(item.baseAmount)).toFixed(2) : item.adjustmentAmount ?? null,
                effectiveAmount: item.kind === "financial" ? item.amount : null,
                caseLineState: item.caseLineState ?? "included",
                servicePricingProfileId: item.servicePricingProfileId ?? null,
                servicePricingItemId: item.servicePricingItemId ?? null,
                servicePricingVersion: item.servicePricingVersion ?? null,
                notes: item.notes,
              })),
          }),
        },
      ),
        body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? "تعذر حفظ المراجعة.");
        return null;
      }
      const authoritative = await load();
      if (!authoritative) return null;
      if (announce) setSuccess(authoritative.review.remaining === 0 && authoritative.operation.type !== "contract"
        ? "تم استلام المبلغ بالكامل — لا يوجد رصيد للترحيل"
        : "تم حفظ المراجعة بنجاح.");
      onChanged();
      return authoritative;
    } catch {
      setError("تعذر حفظ المراجعة.");
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function pay() {
    const value = prompt("قيمة الدفعة");
    if (!value) return;
    const response = await fetch(`/api/v1/operations/${operationId}/payments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: Number(value), notes: null }),
    });
    if (!response.ok)
      setError((await response.json()).error?.message ?? "تعذر تسجيل الدفعة.");
    else {
      await load();
      onChanged();
    }
  }
  async function saveAndPost() {
    if (!data || data.operation.type === "contract" || data.review.posted || (dirty ? settlementPreview : data.review.remaining) === 0 || settlementActionRef.current) return;
    settlementActionRef.current = true;
    const startedDirty = dirty;
    setError("");
    setSuccess("");
    try {
      let authoritative = data;
      if (startedDirty) {
        const saved = await save(false);
        if (!saved) return;
        authoritative = saved;
      }
      if (authoritative.review.posted || authoritative.review.remaining === 0) {
        const finalState = await load();
        if (authoritative.review.remaining === 0) setSuccess("تم استلام المبلغ بالكامل — لا يوجد رصيد للترحيل");
        else if (finalState?.posting) setSuccess(`تم ترحيل ${finalState.posting.amount.toFixed(2)} ج.م ${finalState.posting.direction === "credit" ? "رصيد لصالح الدكتور" : "دين على الدكتور"}`);
        return;
      }
      setBusy(true);
      const response = await fetch(`/api/v1/operations/${operationId}/post-doctor`, { method: "POST" });
      const body = await response.json() as { error?: { code?: string; message?: string } };
      if (!response.ok && body.error?.code !== "ALREADY_POSTED") {
        setError(startedDirty ? "تم حفظ المراجعة، لكن تعذر الترحيل" : body.error?.message ?? "تعذر الترحيل.");
        return;
      }
      const finalState = await load();
      if (finalState?.posting) setSuccess(startedDirty
        ? `تم حفظ المراجعة وترحيل ${finalState.posting.amount.toFixed(2)} ج.م ${finalState.posting.direction === "credit" ? "رصيد لصالح الدكتور" : "دين على الدكتور"}`
        : `تم ترحيل ${finalState.posting.amount.toFixed(2)} ج.م ${finalState.posting.direction === "credit" ? "رصيد لصالح الدكتور" : "دين على الدكتور"}`);
      onChanged();
    } catch {
      setError(startedDirty ? "تم حفظ المراجعة، لكن تعذر الترحيل" : "تعذر الترحيل. لم يتم تسجيل أي حركة.");
    } finally {
      setBusy(false);
      settlementActionRef.current = false;
    }
  }
  function requestClose() { if (dirty && !confirm("لديك تعديلات غير محفوظة. هل تريد تجاهلها؟")) return; onClose(); }
  return (
    <div
      className="operation-drawer review-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="المراجعة المالية"
    >
      <button
        className="operation-drawer__backdrop"
        aria-label="إغلاق"
        onClick={requestClose}
      />
      <section className="simple-review-drawer unified-financial-review">
        <header>
          <div>
            <span>
              {data
                ? `مراجعة مالية ${data.operation.type === "endoscopy" ? "للمناظير" : data.operation.type === "contract" ? "للتعاقد" : "للتفتيت"} · عملية #${data.operation.dailySequence}`
                : "المراجعة المالية"}
            </span>
            <h2>{data?.operation.caseName ?? "جاري التحميل..."}</h2>
            {data && <small className={dirty ? "review-dirty" : data.review.id ? "review-saved" : "review-pending"}>{busy ? "جارٍ الحفظ..." : dirty ? "غير محفوظ" : data.review.id ? "تم الحفظ" : "لم تُحفظ بعد"}</small>}
            {data && (
              <small>
                {data.operation.doctorName || "بدون طبيب"} ·{" "}
                {data.operation.hospitalName || "بدون مستشفى"}
              </small>
            )}
            {data && <button onClick={() => router.push(`/operations#${operationId}`)}>فتح تفاصيل العملية</button>}
          </div>
          <button aria-label="إغلاق" onClick={requestClose}>
            ×
          </button>
        </header>
        <div className="review-editor simple-review-editor">
          {!data ? (
            <p className="operations-state">
              {error || "جاري تحميل المراجعة..."}
            </p>
          ) : (
            <>
              <section className="review-context">
                <h3>السياق التشغيلي التاريخي</h3>
                <div>
                  {data.context.map((field) => (
                    <article key={field.fieldId}>
                      <span>{field.label}</span>
                      <strong>
                        {Array.isArray(field.display)
                          ? field.display.join("، ")
                          : field.display}
                      </strong>
                      {field.operationalValue && (
                        <small>
                          قيمة تشغيلية غير معتمدة: {field.operationalValue}
                        </small>
                      )}
                    </article>
                  ))}
                </div>
              </section>
              {data.servicePricingProfile && <section className={`resolved-pricing-card ${data.servicePricingProfile.warning ? "warning" : ""}`}><div><span>{data.operation.type === "contract" ? "قائمة أسعار المستشفى" : "قائمة أسعار المناظير"}</span><h3>{data.servicePricingProfile.name ?? "لا توجد قائمة أسعار مطابقة"}</h3>{data.servicePricingProfile.version && <small>الإصدار {data.servicePricingProfile.version}{data.servicePricingProfile.matchType === "snapshot" ? " · لقطة محفوظة" : ""}</small>}</div>{data.servicePricingProfile.warning && <p>{data.servicePricingProfile.warning}</p>}</section>}
              {!!data.operationalCostSources.length && (
                <section className="review-suggestions operational-cost-pricing">
                  <h3>البنود المسجلة من العملية</h3>
                  <p>هذه البنود سجلها الموظف. أدخل السعر فقط؛ لا تعاد كتابة البيانات التشغيلية.</p>
                  {data.operationalCostSources.map((source) => {
                    const key = `${source.sourceType}:${source.sourceFieldId ?? ""}:${source.sourceReferenceId ?? ""}`;
                    const configuredReference = data.pricingDefaults?.find((price) => price.source?.sourceType === source.sourceType && price.source?.sourceReferenceId === source.sourceReferenceId)?.defaultAmount;
                    const snapshotReference = data.review.items.find((item) => item.sourceType === source.sourceType && item.sourceReferenceId === source.sourceReferenceId)?.baseAmount;
                    const reference = configuredReference ?? (snapshotReference == null ? null : Number(snapshotReference));
                    return <label className="cost-source-row" key={key}><span><b>{source.contextLabel}</b> — {source.label}<small>السعر التعاقدي / المرجعي: {reference == null ? "غير محدد" : `${reference.toLocaleString("en-US")} ج.م`}</small></span><input aria-label={`${source.contextLabel} ${source.label}`} inputMode="decimal" type="text" placeholder="قيمة الحالة" value={costPrices[key] ?? ""} disabled={!canEdit} onChange={(event) => setCostPrices((current) => ({ ...current, [key]: event.target.value }))} /></label>;
                  })}
                </section>
              )}
              {!!data.orphanedItems?.length && <section className="review-suggestions orphaned-finance-items"><h3>بنود مالية محفوظة لم تعد موجودة في بيانات العملية</h3>{data.orphanedItems.map((item) => <p key={item.id}>{item.description} — {item.amount ?? "—"}</p>)}</section>}
              {!!data.suggestions.length && (
                <section className="review-suggestions">
                  <h3>بنود مقترحة من العملية</h3>
                  {data.suggestions.map((s, i) => (
                    <article
                      key={`${s.sourceType}-${s.sourceFieldId}-${s.sourceReferenceId}-${i}`}
                    >
                      <div>
                        <strong>{s.description}</strong>
                        <small>اقتراح فقط — لا يُحفظ قبل اعتماد المراجعة</small>
                      </div>
                      {canEdit && (
                        <button onClick={() => addSuggestion(s)}>
                          إضافة للمراجعة
                        </button>
                      )}
                    </article>
                  ))}
                </section>
              )}
              {data.operation.type === "lithotripsy" && <div className="operation-grid">
                <label>
                  المبلغ الرئيسي
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={main}
                    disabled={!canEdit}
                    onChange={(e) => setMain(e.target.value)}
                  />
                </label>
                <label>
                  الرصيد النهائي المحسوب
                  <input type="number" value={liveSummary.finalBalance} readOnly />
                </label>
              </div>}
              {!!layout.filter((column) => column.kind === "accountant_input" && column.stableKey !== "main_amount" && column.visible).length && <section className="review-suggestions configured-finance-inputs"><h3>البنود المالية الثابتة</h3>{layout.filter((column) => column.kind === "accountant_input" && column.stableKey !== "main_amount" && column.visible).map((column) => <label className="cost-source-row" key={column.id}><span>{column.label}<small>{column.effect === "subtract" ? "خصم" : column.effect === "add" ? "إضافة" : "محايد"}</small></span><input type="number" min="0" step="0.01" placeholder="القيمة" value={definitionPrices[column.id] ?? ""} disabled={!canEdit} onChange={(event) => setDefinitionPrices((current) => ({ ...current, [column.id]: event.target.value }))} /></label>)}</section>}
              {(data.operationalCostSources.some((source) => source.sourceType === "anesthesiologist") && layout.some((column) => column.stableKey === "anesthesia_account" && column.visible)) && <p className="finance-duplicate-warning">يوجد طبيب تخدير مسجل بالإضافة إلى بند مالي ثابت لحساب التخدير؛ راجع عدم التكرار قبل الحفظ.</p>}
              {(data.operationalCostSources.some((source) => source.sourceType === "technician") && layout.some((column) => column.stableKey === "technician_account" && column.visible)) && <p className="finance-duplicate-warning">يوجد فني مسجل بالإضافة إلى بند مالي ثابت لحساب الفني؛ راجع عدم التكرار قبل الحفظ.</p>}
              <div className="review-items-heading">
                <h3>البنود الاستثنائية</h3>
                {canEdit && (
                  <div>
                    <button onClick={() => addManual("financial")}>
                      + إضافة بند استثنائي
                    </button>
                    <button onClick={() => addManual("note")}>
                      + إضافة ملاحظة
                    </button>
                  </div>
                )}
              </div>
              <div className="financial-items">
                {items.filter((item) => item.sourceType === "manual" && !item.definitionId).map((item, index) => (
                  <div
                    className="financial-item dynamic-financial-item"
                    key={item.id ?? index}
                  >
                    <select
                      value={item.kind}
                      disabled={!canEdit || item.sourceType !== "manual"}
                      onChange={(e) =>
                        updateItem(index, {
                          kind: e.target.value as Item["kind"],
                          amount: e.target.value === "note" ? null : "0.00",
                            financialEffect:
                            e.target.value === "note" ? "neutral" : "subtract",
                        })
                      }
                    >
                      <option value="financial">مالي</option>
                      <option value="note">ملاحظة</option>
                    </select>
                    {item.sourceType === "manual" && item.kind === "financial" ? <SmartSelect label="" type="financial-items" optionsEndpoint="/api/v1/catalogs/financial-items?active=true&limit=50" value={item.description} returnLabel canManage={canEdit} onChange={(value) => updateItem(index, { description: String(value) })} /> : <input value={item.description} disabled={!canEdit} placeholder="اسم الملاحظة" onChange={(e) => updateItem(index, { description: e.target.value })} />}
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.amount ?? ""}
                      disabled={!canEdit || item.kind === "note"}
                      placeholder="القيمة"
                      onChange={(e) =>
                        updateItem(index, { amount: e.target.value })
                      }
                    />
                    <select
                      value={item.financialEffect}
                      disabled={!canEdit || item.kind === "note"}
                      onChange={(e) =>
                        updateItem(index, {
                          financialEffect: e.target
                            .value as Item["financialEffect"],
                        })
                      }
                    >
                      <option value="add">إضافة</option>
                      <option value="subtract">خصم</option>
                      <option value="neutral">محايد</option>
                    </select>
                    {canEdit && (
                      <button
                        aria-label="حذف البند"
                        onClick={() =>
                          setItems((c) => c.filter((_, i) => i !== index))
                        }
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <label className="review-notes-section">
                <span>ملاحظات المراجعة</span>
                <textarea
                  value={notes}
                  disabled={!canEdit}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              <section className="simple-summary">
                <h3>الملخص المالي</h3><div>
                {data.operation.type === "lithotripsy" && <span>المبلغ الأساسي <b>{Number(main || 0).toFixed(2)}</b></span>}
                <span>
                  إجمالي الإضافات <b>{liveSummary.additionTotal.toFixed(2)}</b>
                </span>
                <span>إجمالي الخصومات <b>{liveSummary.deductionTotal.toFixed(2)}</b></span>
                <span>
                  إجمالي التكاليف <b>{liveSummary.totalCosts.toFixed(2)}</b>
                </span>
                <strong>
                  إجمالي حساب الحالة{" "}
                  <b>
                    {liveSummary.finalBalance.toFixed(2)}
                  </b>
                </strong>
                <span>
                  الحالة <b>{statusLabels[data.review.status]}</b>
                </span>
                </div>
              </section>
              {data.operation.type !== "contract" && <section className="simple-settlement unified-settlement"><div className="review-section-title"><div><h3>تسوية حساب الدكتور</h3><small>الحفظ يثبت المراجعة، والترحيل أمر محاسبي مستقل.</small></div></div><div className="settlement-summary"><article><span>إجمالي المستحق على الدكتور</span><strong>{(dirty ? liveSummary.finalBalance : data.review.doctorAccountAmount).toFixed(2)}</strong></article><article><span>المستلم قبل الترحيل</span><strong>{data.review.paid.toFixed(2)}</strong></article><article><span>الرصيد النهائي للتسوية</span><strong>{displayedSettlement.toFixed(2)}</strong></article></div><p className={`settlement-state ${displayedSettlement > 0 ? "is-debit" : displayedSettlement < 0 ? "is-credit" : "is-settled"}`}>{displayedSettlement > 0 ? `دين على الدكتور: ${displayedSettlement.toFixed(2)} ج.م` : displayedSettlement < 0 ? `رصيد لصالح الدكتور: ${Math.abs(displayedSettlement).toFixed(2)} ج.م` : "تم استلام المبلغ بالكامل — لا يوجد رصيد للترحيل"}</p>{dirty && <p className="review-pending">سيُحسم الترحيل من الرصيد المحفوظ بعد إعادة التحميل.</p>}{data.review.posted && <p className="review-saved">تم الترحيل إلى حساب الدكتور{data.posting ? `: ${data.posting.amount.toFixed(2)} ج.م (${data.posting.direction === "credit" ? "لصالح الدكتور" : "دين على الدكتور"})` : ""}.</p>}</section>}
              {error && <p className="form-error">{error}</p>}
              {success && <p className="form-success">{success}</p>}
            </>
          )}
        </div>
        <footer>
          <button onClick={requestClose}>إغلاق</button>
          {data && data.operation.type !== "contract" && canPay && <button onClick={pay}>إضافة دفعة</button>}
          {data && data.operation.type !== "contract" && canPost && !data.review.posted && !data.review.doctorBalanceReceived && (dirty ? settlementPreview : data.review.remaining) !== 0 && (
            <button className="settlement-post-action" disabled={busy || (dirty && !canEdit) || (!dirty && !data.review.id)} onClick={saveAndPost}>{busy ? "جارٍ التنفيذ..." : dirty ? settlementPreview > 0 ? `حفظ وترحيل ${settlementPreview.toFixed(2)} ج.م دين على الدكتور` : `حفظ وترحيل ${Math.abs(settlementPreview).toFixed(2)} ج.م لصالح الدكتور` : data.review.remaining > 0 ? `ترحيل ${data.review.remaining.toFixed(2)} ج.م دين على الدكتور` : `ترحيل ${Math.abs(data.review.remaining).toFixed(2)} ج.م لصالح الدكتور`}</button>
          )}
          {data && canEdit && (
            <button className="primary" disabled={busy} onClick={() => void save()}>
              {busy ? "جارٍ الحفظ..." : "حفظ المراجعة"}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
