/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { MoneyInput } from "@/components/operations/money-input";
import { SmartSelect, type SmartOption } from "@/components/operations/smart-select";
import type { ServicePricingDomain, ServicePricingProfile } from "@/lib/accounting/service-pricing";
import type { ServicePricingSourceCategory } from "@/lib/accounting/service-pricing-sources";

type Draft = {
  mode: "catalog" | "fixed";
  sourceType: string;
  sourceReferenceId: string;
  label: string;
  defaultAmount: string;
  effect: "add" | "subtract" | "neutral";
};
const emptyDraft = (): Draft => ({ mode: "catalog", sourceType: "", sourceReferenceId: "", label: "", defaultAmount: "", effect: "subtract" });
const effectLabels = { subtract: "تكلفة", add: "إضافة", neutral: "محايد" } as const;

export function ServicePricingLibrary({ type }: { type: ServicePricingDomain }) {
  const [profiles, setProfiles] = useState<ServicePricingProfile[]>([]);
  const [sources, setSources] = useState<ServicePricingSourceCategory[]>([]);
  const [selected, setSelected] = useState("");
  const [hospital, setHospital] = useState("");
  const [hospitalName, setHospitalName] = useState("");
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [adding, setAdding] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const endpoint = `/api/v1/financial-reviews/service-pricing/${type}`;

  const load = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setError(body.error?.message ?? "تعذر تحميل مكتبة الأسعار."); return; }
    const nextProfiles = Array.isArray(body.profiles) ? body.profiles : [];
    setProfiles(nextProfiles); setSources(Array.isArray(body.sources) ? body.sources : []);
    setSelected((current) => current && nextProfiles.some((profile: ServicePricingProfile) => profile.id === current) ? current : "");
  }, [endpoint]);
  useEffect(() => { void load(); }, [load]);

  const profile = profiles.find((item) => item.id === selected) ?? null;
  const currentSource = sources.find((source) => source.sourceType === draft.sourceType) ?? null;

  async function send(method: "POST" | "PATCH", payload: Record<string, unknown>) {
    setBusy(true); setError(""); setNotice("");
    const response = await fetch(endpoint, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({})); setBusy(false);
    if (!response.ok) { setError(body.error?.message ?? "تعذر حفظ التسعير."); return false; }
    const nextProfiles = Array.isArray(body.profiles) ? body.profiles : [];
    setProfiles(nextProfiles); setNotice("تم حفظ التغييرات."); return true;
  }
  async function createProfile() {
    const ok = await send("POST", { hospitalId: type === "contract" ? hospital : null, name: name.trim() || (type === "contract" ? `تعاقد — ${hospitalName}` : "الأسعار العامة للمناظير") });
    if (ok) { setHospital(""); setName(""); setShowCreate(false); }
  }
  async function addItem() {
    if (!profile) return;
    const payload = draft.mode === "fixed"
      ? { action: "add_item", profileId: profile.id, sourceType: "manual", label: draft.label, defaultAmount: draft.defaultAmount, effect: draft.effect }
      : { action: "add_item", profileId: profile.id, sourceType: draft.sourceType, sourceReferenceId: draft.sourceReferenceId || null, label: currentSource ? `${currentSource.name} — افتراضي للفئة` : "", defaultAmount: draft.defaultAmount, effect: draft.effect };
    if (await send("PATCH", payload)) { setDraft(emptyDraft()); setAdding(false); }
  }
  function updateLocal(itemId: string, patch: { defaultAmount?: number | null; effect?: "add" | "subtract" | "neutral" }) {
    setProfiles((current) => current.map((candidate) => candidate.id !== profile?.id ? candidate : { ...candidate, items: candidate.items.map((item) => item.id === itemId ? { ...item, ...patch } : item) }));
  }

  return <main className="service-pricing-page unified-pricing-workspace" dir="rtl">
    <header className="pricing-profiles-hero"><div><nav aria-label="مسار الصفحة"><Link href="/accounts/pricing">بنود وأسعار</Link><span aria-hidden="true">/</span><span>{type === "contract" ? "التعاقد" : "المناظير"}</span></nav><h1>{type === "contract" ? "أسعار التعاقد" : "أسعار المناظير"}</h1><p>{type === "contract" ? "اختر المستشفى ثم عدّل بنوده وأسعاره التعاقدية." : "قائمة عامة مرتبطة ببنود نموذج المناظير التشغيلي."}</p></div><button className="pricing-primary-action" disabled={type === "endoscopy" && profiles.some((item) => item.active)} onClick={() => setShowCreate((current) => !current)}>{type === "contract" ? "+ قائمة مستشفى" : "+ إنشاء القائمة العامة"}</button></header>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-success" role="status">{notice}</p>}
    {showCreate && <section className="service-pricing-create"><div><span>قائمة جديدة</span><h2>{type === "contract" ? "اختر المستشفى" : "الأسعار العامة للمناظير"}</h2></div>{type === "contract" && <SmartSelect label="المستشفى" type="hospitals" value={hospital} canManage={false} onChange={(value) => setHospital(String(value))} onOptionChange={(option) => setHospitalName(option?.name ?? "")} />}<label>اسم القائمة <small>(اختياري)</small><input value={name} placeholder={type === "contract" ? "يُنشأ تلقائياً من اسم المستشفى" : "الأسعار العامة للمناظير"} onChange={(event) => setName(event.target.value)} /></label><footer><button onClick={() => setShowCreate(false)}>إلغاء</button><button className="primary" disabled={busy || (type === "contract" && !hospital)} onClick={() => void createProfile()}>حفظ القائمة</button></footer></section>}
    <div className={`service-pricing-workspace ${profile ? "has-selection" : ""}`}>
      <aside aria-label={type === "contract" ? "قوائم المستشفيات" : "قائمة المناظير"}><header><span>الخطوة الأولى</span><h2>{type === "contract" ? "اختر المستشفى" : "قائمة الأسعار"}</h2></header>{profiles.map((item) => <button key={item.id} className={selected === item.id ? "active" : ""} onClick={() => setSelected(item.id)}><strong>{item.hospitalName ?? item.name}</strong><small>{item.active ? `${item.items.filter((line) => line.active).length} بنود · الإصدار ${item.version}` : "مؤرشف"}</small><span aria-hidden="true">←</span></button>)}{!profiles.length && <div className="pricing-empty-state"><strong>لا توجد قوائم أسعار بعد.</strong><small>أنشئ أول قائمة للبدء.</small></div>}</aside>
      <section className="service-pricing-detail">{profile ? <><button className="pricing-mobile-back" onClick={() => setSelected("")}>→ رجوع إلى القوائم</button><header><div><span>{type === "contract" ? profile.hospitalName : "قائمة عامة"}</span><h2>{profile.name}</h2><small>الإصدار {profile.version} · {profile.active ? "نشط" : "مؤرشف"}</small></div><button className="pricing-archive-action" onClick={() => void send("PATCH", { action: profile.active ? "archive_profile" : "restore_profile", profileId: profile.id })}>{profile.active ? "أرشفة القائمة" : "استعادة القائمة"}</button></header>
        <div className="pricing-items-heading"><div><span>الخطوة الثانية</span><h3>البنود والأسعار</h3></div>{profile.active && <button className="primary" onClick={() => setAdding(true)}>+ إضافة بند</button>}</div>
        <div className="service-price-items">{profile.items.map((line) => <article className={!line.active ? "archived" : ""} key={line.id}><div className="service-price-item__identity"><span className={line.sourceReferenceId ? "catalog" : "fixed"}>{line.sourceReferenceId ? "بند مسجل" : line.sourceType === "manual" || line.sourceType === "other" ? "بند مالي ثابت" : "افتراضي للفئة"}</span><strong>{line.label}</strong><small>{line.sourceReferenceId ? "مرتبط بنفس العنصر المستخدم في نموذج العملية" : line.sourceType === "manual" || line.sourceType === "other" ? "غير مرتبط بقائمة تشغيلية" : "يُستخدم عند عدم وجود سعر مخصص"}</small></div><label>السعر الافتراضي<MoneyInput value={line.defaultAmount == null ? "" : String(line.defaultAmount)} disabled={!line.active} ariaLabel={`السعر الافتراضي ${line.label}`} onChange={(value) => updateLocal(line.id, { defaultAmount: value == null ? null : Number(value) })} /></label><label>التأثير<select value={line.effect} disabled={!line.active} onChange={(event) => updateLocal(line.id, { effect: event.target.value as typeof line.effect })}>{Object.entries(effectLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><div className="service-price-item__actions"><button disabled={!line.active} onClick={() => void send("PATCH", { action: "update_item", itemId: line.id, label: line.label, defaultAmount: line.defaultAmount, effect: line.effect, notes: line.notes })}>حفظ</button><button onClick={() => void send("PATCH", { action: line.active ? "archive_item" : "restore_item", itemId: line.id })}>{line.active ? "أرشفة" : "استعادة"}</button></div></article>)}{!profile.items.length && <div className="pricing-empty-state"><strong>لا توجد بنود في هذه القائمة.</strong><small>اختر بنداً مسجلاً في نموذج العمليات أو أضف بنداً مالياً ثابتاً.</small></div>}</div>
        {adding && <section className="service-price-item-editor" aria-label="إضافة بند تسعير"><header><div><span>إضافة بند</span><h3>{draft.mode === "catalog" ? "اختيار من البنود المسجلة" : "إضافة بند مالي ثابت"}</h3></div><button aria-label="إغلاق" onClick={() => setAdding(false)}>×</button></header><div className="pricing-item-kind"><button className={draft.mode === "catalog" ? "active" : ""} onClick={() => setDraft({ ...emptyDraft(), mode: "catalog" })}><strong>اختيار من البنود المسجلة</strong><small>نفس العنصر المستخدم في إضافة الشغل</small></button><button className={draft.mode === "fixed" ? "active" : ""} onClick={() => setDraft({ ...emptyDraft(), mode: "fixed" })}><strong>بند مالي ثابت</strong><small>رسوم لا تقابل عنصراً تشغيلياً</small></button></div>{draft.mode === "catalog" ? <><label>مجموعة البند<select value={draft.sourceType} onChange={(event) => setDraft({ ...emptyDraft(), mode: "catalog", sourceType: event.target.value })}><option value="">اختر المجموعة</option>{sources.map((source) => <option value={source.sourceType} key={source.sourceType}>{source.name}</option>)}</select></label>{currentSource && <><SmartSelect label={`ابحث في ${currentSource.name}`} type={currentSource.catalogSource} optionsEndpoint={`${endpoint}?catalog=${currentSource.catalogSource}`} value={draft.sourceReferenceId} canManage={false} onChange={(value) => setDraft((current) => ({ ...current, sourceReferenceId: String(value) }))} onOptionChange={(option: SmartOption | null) => setDraft((current) => ({ ...current, label: option?.name ?? "" }))} /><label className="pricing-generic-choice"><input type="checkbox" checked={!draft.sourceReferenceId} onChange={(event) => setDraft((current) => ({ ...current, sourceReferenceId: event.target.checked ? "" : current.sourceReferenceId }))} /> سعر افتراضي لأي عنصر من هذه الفئة</label></>}</> : <label>اسم البند المالي<input autoFocus value={draft.label} placeholder="مثال: رسوم تشغيل خاصة" onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label>}<label>السعر الافتراضي<MoneyInput value={draft.defaultAmount} ariaLabel="السعر الافتراضي للبند الجديد" onChange={(value) => setDraft({ ...draft, defaultAmount: value ?? "" })} /></label><label>التأثير<select value={draft.effect} onChange={(event) => setDraft({ ...draft, effect: event.target.value as Draft["effect"] })}>{Object.entries(effectLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><footer><button onClick={() => setAdding(false)}>إلغاء</button><button className="primary" disabled={busy || (draft.mode === "catalog" ? !draft.sourceType : draft.label.trim().length < 2)} onClick={() => void addItem()}>حفظ البند</button></footer></section>}
      </> : <div className="pricing-detail-placeholder"><span>←</span><strong>{type === "contract" ? "اختر مستشفى لعرض قائمته" : "اختر قائمة الأسعار لعرض بنودها"}</strong><small>ستظهر البنود والأسعار هنا بدون مغادرة الصفحة.</small></div>}</section>
    </div>
  </main>;
}
