/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MoneyInput } from "@/components/operations/money-input";
import { useDialogScrollLock } from "@/components/settings/users/use-dialog-scroll-lock";
import { calculateDirectItemsDue, calculateDirectPaymentSummary, calculateSimpleReviewTotals, type FinancialAccountingMode } from "@/lib/accounting/simple-review";

type Effect = "add" | "subtract" | "neutral";
type LineState = "included" | "excluded";
type Line = {
  id?: string;
  kind: "financial" | "note";
  description: string;
  amount: string | null;
  baseAmount?: string | null;
  adjustmentAmount?: string | null;
  effectiveAmount?: string | null;
  caseLineState?: LineState;
  financialEffect: Effect;
  sourceType: "dynamic_field" | "anesthesiologist" | "technician" | "procedure" | "equipment" | "consumable" | "stent" | "manual" | "other";
  sourceFieldId: string | null;
  sourceReferenceId: string | null;
  definitionId?: string | null;
  pricingProfileId?: string | null;
  pricingProfileLineId?: string | null;
  pricingProfileVersion?: number | null;
  pricingOrigin?: "specific_source_default" | "profile_role_default" | "profile_fixed_line" | "none" | null;
  catalogItemId?: string | null;
  notes: string | null;
};
type ContextField = { fieldId: string; stableKey: string; label: string; display: string | string[] };
type PricingDefault = {
  label: string;
  defaultAmount: number | null;
  effect: Effect;
  definitionId?: string | null;
  profileId?: string | null;
  profileLineId?: string | null;
  profileVersion?: number | null;
  pricingOrigin?: Line["pricingOrigin"];
  source?: { sourceType: Line["sourceType"]; sourceFieldId: string | null; sourceReferenceId: string | null } | null;
};
type ReviewData = {
  operation: { caseName: string; doctorName?: string | null; hospitalName?: string | null; operationDate: string; operationTime?: string | null; employeeName?: string | null };
  operationContext: ContextField[];
  pricingDefaults?: PricingDefault[] | null;
  hydratedFinancialItems?: Line[];
  pricingProfile?: { id: string | null; name: string | null; version: number | null; matchType: string | null; sessionNumber: number | null; sessionId?: string | null; sessionName?: string | null; warningMessage: string | null } | null;
  review: { id: string | null; accountingMode: FinancialAccountingMode; mainAmount: number; doctorAccountAmount: number; doctorReceivedAmount: number | null; paymentState: "unpaid" | "partial" | "paid"; doctorBalanceReceived: boolean; notes: string | null; updatedAt: string | null; items: Line[]; paid: number; remaining: number; posted: boolean; payments: Array<{ id: string; amount: string; paidAt: string }> };
  posting?: { id: string; amount: number; direction: "debit" | "credit"; signedAmount: number; postedAt: string } | null;
};

const sourceKey = (line: Pick<Line, "sourceType" | "sourceFieldId" | "sourceReferenceId">) => `${line.sourceType}:${line.sourceFieldId ?? ""}:${line.sourceReferenceId ?? ""}`;
const textAmount = (value: string | number | null | undefined) => value == null ? null : String(value);
const money = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sessionLabel = (value: number | null | undefined) => value === 1 ? "الجلسة الأولى" : value === 2 ? "الجلسة الثانية" : "جلسة غير محددة";
const effectLabel = (value: Effect) => value === "add" ? "إضافة" : value === "subtract" ? "خصم / تكلفة" : "محايد";
const pricingOriginLabel = (origin: Line["pricingOrigin"], hasReference: boolean) => origin === "specific_source_default"
  ? "سعر مخصص لهذا العنصر"
  : origin === "profile_role_default"
    ? "السعر الافتراضي للفئة"
    : origin === "none" && !hasReference
      ? "لا يوجد سعر افتراضي لهذا العنصر"
      : origin === "profile_fixed_line"
        ? "بند ثابت من قالب التسعير"
        : null;

function lineFromDefault(price: PricingDefault): Line {
  const base = textAmount(price.defaultAmount);
  return {
    kind: "financial", description: price.label, amount: base, baseAmount: base,
    adjustmentAmount: base == null ? null : "0", effectiveAmount: base,
    caseLineState: "included", financialEffect: price.effect,
    sourceType: price.source?.sourceType ?? "other",
    sourceFieldId: price.source?.sourceFieldId ?? null,
    sourceReferenceId: price.source?.sourceReferenceId ?? null,
    definitionId: price.source || price.profileLineId ? null : price.definitionId ?? null,
    pricingProfileId: price.profileId || null,
    pricingProfileLineId: price.profileLineId || null,
    pricingProfileVersion: price.profileVersion ?? null,
    pricingOrigin: price.pricingOrigin ?? null,
    notes: null,
  };
}

function normalizedLines(data: ReviewData) {
  const existing: Line[] = data.review.items.map(({ id: _savedItemId, ...item }) => {
    void _savedItemId;
    return { ...item, amount: textAmount(item.amount), baseAmount: textAmount(item.baseAmount), adjustmentAmount: textAmount(item.adjustmentAmount), effectiveAmount: textAmount(item.effectiveAmount ?? item.amount), caseLineState: item.caseLineState ?? "included" as LineState };
  });
  if (data.review.id) return existing;
  if (data.hydratedFinancialItems) return data.hydratedFinancialItems.map((item) => ({ ...item }));
  const sources = new Set(existing.filter((item) => !["manual", "other"].includes(item.sourceType)).map(sourceKey));
  const profileLines = new Set(existing.map((item) => item.pricingProfileLineId).filter(Boolean));
  const definitions = new Set(existing.map((item) => item.definitionId).filter(Boolean));
  const result = [...existing];
  for (const price of data.pricingDefaults ?? []) {
    if (price.profileLineId && profileLines.has(price.profileLineId)) continue;
    if (price.source && sources.has(sourceKey(price.source))) continue;
    if (price.definitionId && definitions.has(price.definitionId)) continue;
    result.push(lineFromDefault(price));
  }
  return result;
}

function stateSignature(mode: FinancialAccountingMode, main: string, received: string, notes: string, lines: Line[], settlement: string) {
  return JSON.stringify({ mode, main, received, notes, lines, settlement });
}

export function LithotripsySimpleReviewEditor({ operationId, canEdit, canPost, onClose, onChanged }: { operationId: string; canEdit: boolean; canPost: boolean; onClose: () => void; onChanged: () => void }) {
  useDialogScrollLock(true, false);
  const [data, setData] = useState<ReviewData | null>(null);
  const [main, setMain] = useState("");
  const [mode, setMode] = useState<FinancialAccountingMode>("main_amount");
  const [received, setReceived] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [notes, setNotes] = useState("");
  const [settlement, setSettlement] = useState("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [initial, setInitial] = useState("");
  const settlementActionRef = useRef(false);

  const load = useCallback(async () => {
    setError("");
    const response = await fetch(`/api/v1/operations/${operationId}/financial-review`, { cache: "no-store" });
    const body = await response.json() as ReviewData & { error?: { message?: string } };
    if (!response.ok) { setError(body.error?.message ?? "تعذر تحميل المراجعة."); return null; }
    const nextLines = normalizedLines(body);
    const nextMain = body.review.id ? String(body.review.mainAmount) : "";
    const nextMode = body.review.accountingMode ?? "main_amount";
    const nextReceived = body.review.doctorReceivedAmount == null ? "" : String(body.review.doctorReceivedAmount);
    const nextNotes = body.review.notes ?? "";
    const nextSettlement = body.review.doctorBalanceReceived ? "delivered" : "none";
    setData(body); setMode(nextMode); setMain(nextMain); setReceived(nextReceived); setNotes(nextNotes); setLines(nextLines); setSettlement(nextSettlement);
    setInitial(stateSignature(nextMode, nextMain, nextReceived, nextNotes, nextLines, nextSettlement));
    return body;
  }, [operationId]);
  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => calculateSimpleReviewTotals(Number(main || 0), lines), [main, lines]);
  const amountDue = mode === "direct_items" ? calculateDirectItemsDue(lines) : totals.finalBalance;
  const payment = calculateDirectPaymentSummary(amountDue, received === "" ? null : Number(received));
  const dirty = initial !== "" && initial !== stateSignature(mode, main, received, notes, lines, settlement);
  const update = (index: number, patch: Partial<Line>) => { setSuccess(""); setLines((current) => current.map((line, itemIndex) => itemIndex === index ? { ...line, ...patch } : line)); };
  const setCaseAmount = (index: number, value: string | null) => {
    const line = lines[index];
    const amount = value == null || value === "" ? null : value;
    const base = line.baseAmount == null || line.baseAmount === "" ? null : Number(line.baseAmount);
    const adjustment = amount == null || base == null ? null : String(Math.round((Number(amount) - base) * 100) / 100);
    update(index, { amount, effectiveAmount: amount, adjustmentAmount: adjustment });
  };
  const addCost = () => setLines((current) => [...current, { kind: "financial", description: "", amount: null, baseAmount: null, adjustmentAmount: null, effectiveAmount: null, caseLineState: "included", financialEffect: "subtract", sourceType: "manual", sourceFieldId: null, sourceReferenceId: null, notes: null }]);
  const addNote = () => setLines((current) => [...current, { kind: "note", description: "", amount: null, caseLineState: "included", financialEffect: "neutral", sourceType: "manual", sourceFieldId: null, sourceReferenceId: null, notes: null }]);
  const remove = (index: number) => update(index, { caseLineState: "excluded" });
  const restore = (index: number) => update(index, { caseLineState: "included", effectiveAmount: lines[index].amount });

  const save = async (announce = true): Promise<ReviewData | null> => {
    if (!data || busy) return null;
    const incomplete = lines.find((line) => line.kind === "financial" && line.caseLineState !== "excluded" && line.description.trim() && (line.amount == null || line.amount === ""));
    if (incomplete) { setError(`أدخل قيمة الحالة للبند: ${incomplete.description}`); return null; }
    setBusy(true); setError(""); setSuccess("");
    const items = lines.filter((line) => line.description.trim() && (line.kind === "note" || line.caseLineState === "excluded" || line.amount != null)).map((line) => {
      const { pricingOrigin: _pricingOrigin, ...persistedLine } = line;
      void _pricingOrigin;
      return ({
      ...persistedLine,
      amount: line.kind === "note" ? null : line.amount,
      baseAmount: line.baseAmount == null || line.baseAmount === "" ? null : line.baseAmount,
      adjustmentAmount: line.adjustmentAmount == null || line.adjustmentAmount === "" ? null : line.adjustmentAmount,
      effectiveAmount: line.kind === "note" ? "0" : line.amount,
      notes: line.notes?.trim() || null,
    }); });
    try {
      const response = await fetch(`/api/v1/operations/${operationId}/financial-review`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedUpdatedAt: data.review.updatedAt, accountingMode: mode, mainAmount: mode === "main_amount" ? (main === "" ? null : main) : null, doctorReceivedAmount: mode === "direct_items" ? (received === "" ? null : received) : null, doctorBalanceReceived: settlement === "delivered", notes: notes.trim() || null, items }) });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) { setError(body.error?.message ?? "تعذر حفظ المراجعة."); return null; }
      const authoritative = await load();
      if (!authoritative) return null;
      if (announce) setSuccess(authoritative.review.remaining === 0
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
  };
  const saveAndPost = async () => {
    if (!data || data.review.posted || payment.remaining === 0 || settlementActionRef.current) return;
    settlementActionRef.current = true;
    const startedDirty = dirty;
    setError(""); setSuccess("");
    try {
      let authoritative = data;
      if (startedDirty) {
        const saved = await save(false);
        if (!saved) return;
        authoritative = saved;
      }
      if (authoritative.review.posted) { await load(); return; }
      if (authoritative.review.remaining === 0) {
        setSuccess("تم استلام المبلغ بالكامل — لا يوجد رصيد للترحيل");
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
      if (!finalState) return;
      if (finalState.posting) setSuccess(startedDirty
        ? `تم حفظ المراجعة وترحيل ${money(finalState.posting.amount)} ج.م ${finalState.posting.direction === "credit" ? "رصيد لصالح الدكتور" : "دين على الدكتور"}`
        : "تم ترحيل المبلغ إلى حساب الطبيب.");
      onChanged();
    } catch {
      setError(startedDirty ? "تم حفظ المراجعة، لكن تعذر الترحيل" : "تعذر الترحيل. لم يتم تسجيل أي حركة.");
    } finally {
      setBusy(false);
      settlementActionRef.current = false;
    }
  };
  const close = () => { if (!dirty || window.confirm("لديك تعديلات غير محفوظة. هل تريد تجاهلها؟")) onClose(); };

  if (!data) return <div className="operation-drawer review-drawer"><button className="operation-drawer__backdrop" aria-label="إغلاق" onClick={close}/><section className="simple-review-drawer"><main className="review-editor"><p className={`operations-state${error ? " error" : ""}`}>{error || "جاري تحميل المراجعة..."}</p></main></section></div>;

  const contextOrder = ["case_name", "doctor", "hospital", "operation_date", "session_count", "procedures", "anesthesiologist", "technician", "equipment", "stents", "consumables", "side", "anesthesia_type", "participants", "operation_time", "diagnosis", "notes"];
  const operationContext: ContextField[] = data.operationContext.some((field) => field.stableKey === "session_count") || !data.pricingProfile
    ? data.operationContext
    : [...data.operationContext, { fieldId: "resolved-session", stableKey: "session_count", label: "الجلسة", display: data.pricingProfile.sessionName ?? sessionLabel(data.pricingProfile.sessionNumber) }];
  const context = operationContext.filter((field, index, all) => all.findIndex((candidate) => candidate.stableKey === field.stableKey) === index).sort((a, b) => (contextOrder.indexOf(a.stableKey) < 0 ? 99 : contextOrder.indexOf(a.stableKey)) - (contextOrder.indexOf(b.stableKey) < 0 ? 99 : contextOrder.indexOf(b.stableKey)));
  const financial = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.kind === "financial" && line.caseLineState !== "excluded");
  const itemNotes = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.kind === "note" && line.caseLineState !== "excluded");
  const excluded = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.caseLineState === "excluded");
  const profile = data.pricingProfile;
  const matchLabel = profile?.matchType === "exact" ? "مطابقة تامة" : profile?.matchType === "session_base" ? "قالب أساسي لنفس الجلسة" : profile?.matchType === "snapshot" ? "مرجع محفوظ مع المراجعة" : profile?.matchType === "legacy" ? "قالب قديم" : "لا يوجد تطابق";

  return <div className="operation-drawer review-drawer" role="dialog" aria-modal="true" aria-label="مراجعة مالية موحدة">
    <button className="operation-drawer__backdrop" aria-label="إغلاق" onClick={close}/>
    <section className="simple-review-drawer unified-financial-review">
      <header><div><span>مراجعة مالية للتفتيت</span><h2>{data.operation.caseName}</h2><small>{data.operation.doctorName || "بدون طبيب"} · {data.operation.operationDate}</small><div className={busy ? "review-pending" : dirty ? "review-dirty" : "review-saved"}>{busy ? "جارٍ الحفظ..." : dirty ? "تعديلات غير محفوظة" : data.review.id ? "تم الحفظ" : "مراجعة جديدة"}</div></div><button aria-label="إغلاق" onClick={close}>×</button></header>
      <main className="review-editor simple-review-editor">
        <section className="review-context unified-operation-context"><div className="review-section-title"><div><h3>بيانات العملية</h3><small>السياق التشغيلي — للقراءة فقط</small></div></div><div>{context.map((field) => <article key={field.stableKey}><span>{field.label}</span><strong>{field.stableKey === "session_count" && Number.isFinite(Number(field.display)) ? sessionLabel(Number(field.display)) : Array.isArray(field.display) ? field.display.join("، ") : field.display}</strong></article>)}</div></section>
        <section className={`resolved-pricing-card ${profile?.warningMessage ? "warning" : ""}`}><div><span>قائمة الأسعار المطابقة</span><h3>{profile?.name || "لا توجد قائمة أسعار مطابقة"}</h3><small>{profile?.sessionName || sessionLabel(profile?.sessionNumber)} · {matchLabel}{profile?.version ? ` · الإصدار ${profile.version}` : ""}</small></div>{profile?.warningMessage && <p>{profile.warningMessage}</p>}</section>
        <section className="accounting-mode-card"><div><h3>طريقة حساب الحالة</h3><small>اختر الطريقة التي تعكس اتفاق الحساب لهذه العملية.</small></div><div className="accounting-mode-options"><button type="button" className={mode === "direct_items" ? "active" : ""} disabled={!canEdit} onClick={() => { setSuccess(""); setMode("direct_items"); }}>حساب البنود مباشرة<small>إجمالي البنود هو حساب الدكتور</small></button><button type="button" className={mode === "main_amount" ? "active" : ""} disabled={!canEdit} onClick={() => { setSuccess(""); setMode("main_amount"); }}>مبلغ رئيسي<small>البنود تعدّل مبلغاً أساسياً</small></button></div></section>
        {mode === "main_amount" && <section className="simple-main-amount"><div><h3>المبلغ الرئيسي</h3><small>المبلغ المستلم أو الأساسي لهذه الحالة</small></div><label className="main-amount-entry"><span>أدخل المبلغ</span><MoneyInput value={main} disabled={!canEdit} placeholder="أدخل المبلغ" ariaLabel="المبلغ الرئيسي لهذه الحالة" onChange={(value) => { setSuccess(""); setMain(value ?? ""); }}/></label></section>}
        <section className="simple-cost-lines unified-cost-lines">
          <div className="review-items-heading"><div><h3>بنود حساب الحالة</h3><small>السعر المرجعي من قائمة الأسعار لا يتغير عند تعديل قيمة هذه الحالة.</small></div>{canEdit && <button type="button" className="add-case-item" onClick={addCost}>+ إضافة بند جديد</button>}</div>
          {financial.length === 0 && <p className="empty-financial-lines">لا توجد بنود مالية بعد. يمكن إضافة بند خاص بهذه الحالة.</p>}
          {financial.map(({ line, index }) => <article className={`simple-cost-row unified-cost-row ${line.sourceType === "manual" ? "is-case-manual" : ""}`} key={line.id ?? `${line.sourceType}-${index}`}>
            <div className="simple-cost-label">{line.sourceType === "manual" ? <input aria-label="اسم البند" value={line.description} disabled={!canEdit} placeholder="اسم البند" onChange={(event) => update(index, { description: event.target.value })}/> : <strong className="financial-line-name">{line.description}</strong>}<small>{line.sourceType === "manual" ? "بند خاص بهذه الحالة" : "بند من القالب أو العملية"}</small>{pricingOriginLabel(line.pricingOrigin, line.baseAmount != null) && <span className={`pricing-origin ${line.pricingOrigin === "none" ? "is-unpriced" : ""}`}>{pricingOriginLabel(line.pricingOrigin, line.baseAmount != null)}</span>}</div>
            <div className="reference-price"><small>السعر الافتراضي / المرجعي</small><b>{line.baseAmount == null ? "غير محدد" : `${money(Number(line.baseAmount))} ج.م`}</b></div>
            <label className="case-price"><small>قيمة الحالة</small><MoneyInput value={line.amount} disabled={!canEdit} placeholder="أدخل المبلغ" ariaLabel={`قيمة الحالة للبند ${line.description || "المالي"}`} onChange={(value) => setCaseAmount(index, value)}/></label>
            <div className="effective-price"><small>القيمة المحتسبة</small><b>{line.amount == null ? "—" : `${money(Number(line.amount))} ج.م`}</b>{line.baseAmount != null && line.adjustmentAmount != null && Number(line.adjustmentAmount) !== 0 && <em>{Number(line.adjustmentAmount) > 0 ? "+" : ""}{money(Number(line.adjustmentAmount))}</em>}</div>
            <label className="line-effect"><small>التأثير</small><select value={line.financialEffect} disabled={!canEdit || line.sourceType !== "manual"} onChange={(event) => update(index, { financialEffect: event.target.value as Effect })}><option value="add">إضافة</option><option value="subtract">خصم / تكلفة</option><option value="neutral">محايد</option></select></label>
            <label className="line-note"><small>ملاحظة البند (اختياري)</small><input value={line.notes ?? ""} disabled={!canEdit} placeholder="سبب التعديل أو توضيح" onChange={(event) => update(index, { notes: event.target.value })}/></label>
            {canEdit && <button type="button" className="simple-remove" onClick={() => remove(index)}>إزالة من الحالة</button>}
          </article>)}
          {excluded.length > 0 && <details className="excluded-lines"><summary>بنود مستبعدة من هذه الحالة ({excluded.length})</summary>{excluded.map(({ line, index }) => <div key={line.id ?? `excluded-${index}`}><span><b>{line.description}</b><small>{line.amount == null ? "بدون قيمة" : `${money(Number(line.amount))} ج.م`} · {effectLabel(line.financialEffect)}</small></span>{canEdit && <button type="button" onClick={() => restore(index)}>استعادة</button>}</div>)}</details>}
        </section>
        <section className="review-notes-section"><div className="review-items-heading"><div><h3>الملاحظات</h3><small>الملاحظات لا تدخل في الحسابات.</small></div>{canEdit && <button type="button" onClick={addNote}>+ إضافة ملاحظة بند</button>}</div>{itemNotes.map(({ line, index }) => <div className="review-note-row" key={line.id ?? `note-${index}`}><input value={line.description} disabled={!canEdit} placeholder="اكتب الملاحظة" onChange={(event) => update(index, { description: event.target.value })}/>{canEdit && <button type="button" onClick={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}>حذف</button>}</div>)}<label><span>ملاحظة المراجعة</span><textarea value={notes} disabled={!canEdit} rows={3} placeholder="توضيح عام للمراجعة أو التسوية" onChange={(event) => { setSuccess(""); setNotes(event.target.value); }}/></label></section>
        <section className="simple-summary"><h3>الملخص المالي</h3><div>{mode === "main_amount" && <span>المبلغ الأساسي <b>{money(Number(main || 0))}</b></span>}<span>إجمالي الإضافات <b>{money(totals.additionTotal)}</b></span><span>إجمالي الخصومات والتكاليف <b>{money(totals.deductionTotal)}</b></span><strong>إجمالي حساب الحالة <b>{money(amountDue)} ج.م</b></strong></div></section>
        {mode === "direct_items" && <section className="doctor-payment-card"><div className="review-section-title"><div><h3>تحصيل من الدكتور</h3><small>سجّل ما تم استلامه فعلياً لهذه الحالة.</small></div></div><div className="doctor-payment-grid"><article><span>إجمالي حساب الحالة</span><strong>{money(payment.due)} ج.م</strong></article><label><span>المبلغ المستلم من الدكتور</span><MoneyInput value={received} disabled={!canEdit} placeholder="أدخل المبلغ المستلم" ariaLabel="المبلغ المستلم من الدكتور" onChange={(value) => { setSuccess(""); setReceived(value ?? ""); }}/></label><article><span>المتبقي</span><strong>{money(payment.remaining)} ج.م</strong></article><article className={`payment-state is-${payment.state}`}><span>حالة السداد</span><strong>{payment.state === "paid" ? "مدفوع بالكامل" : payment.state === "partial" ? "مدفوع جزئياً" : "غير مدفوع"}</strong></article></div></section>}
        <section className="simple-settlement unified-settlement"><div className="review-section-title"><div><h3>تسوية حساب الدكتور</h3><small>الحفظ يثبت المراجعة، والترحيل أمر محاسبي مستقل.</small></div></div><div className="settlement-summary"><article><span>إجمالي المستحق على الدكتور</span><strong>{money(payment.due)} ج.م</strong></article><article><span>المستلم قبل الترحيل</span><strong>{money(payment.received ?? 0)} ج.م</strong></article><article><span>الرصيد النهائي للتسوية</span><strong>{money(payment.remaining)} ج.م</strong></article></div><p className={`settlement-state ${payment.remaining > 0 ? "is-debit" : payment.remaining < 0 ? "is-credit" : "is-settled"}`}>{payment.remaining > 0 ? `دين على الدكتور: ${money(payment.remaining)} ج.م` : payment.remaining < 0 ? `رصيد لصالح الدكتور: ${money(Math.abs(payment.remaining))} ج.م` : "تم استلام المبلغ بالكامل — لا يوجد رصيد للترحيل"}</p>{dirty && <p className="review-pending">احفظ المراجعة أولاً لتفعيل الترحيل.</p>}{data.review.posted && <p className="review-saved">تم الترحيل إلى حساب الدكتور{data.posting ? `: ${money(data.posting.amount)} ج.م (${data.posting.direction === "credit" ? "لصالح الدكتور" : "دين على الدكتور"})` : ""}.</p>}</section>
        {error && <p className="form-error" role="alert">{error}</p>}{success && <p className="form-success" role="status">{success}</p>}
      </main>
      <footer><button onClick={close}>إغلاق</button>{canEdit && <button className="primary" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "جارٍ الحفظ..." : dirty ? "حفظ المراجعة" : "تم الحفظ"}</button>}{canPost && !data.review.posted && payment.remaining !== 0 && <button className="settlement-post-action" disabled={busy || (dirty && !canEdit) || (!dirty && !data.review.id)} onClick={saveAndPost}>{busy ? "جارٍ التنفيذ..." : dirty ? payment.remaining > 0 ? `حفظ وترحيل ${money(payment.remaining)} ج.م دين على الدكتور` : `حفظ وترحيل ${money(Math.abs(payment.remaining))} ج.م لصالح الدكتور` : payment.remaining > 0 ? `ترحيل ${money(payment.remaining)} ج.م دين على الدكتور` : `ترحيل ${money(Math.abs(payment.remaining))} ج.م لصالح الدكتور`}</button>}</footer>
    </section>
  </div>;
}
