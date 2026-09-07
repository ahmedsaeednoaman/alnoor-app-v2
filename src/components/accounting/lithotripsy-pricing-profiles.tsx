/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MoneyInput } from "@/components/operations/money-input";
import { SmartSelect } from "@/components/operations/smart-select";
import { financialSourceDisplayLabel } from "@/lib/accounting/lithotripsy-source-types";

type Procedure = { id: string; name: string };
type SessionNumber = number;
type Session={id:string;sessionNumber:number;name:string;sortOrder:number;active:boolean;archivedAt:string|null};
type LineType = "linked_role" | "linked_source" | "fixed_cost" | "session_cost";
type Line = {
  id?: string;
  stableKey?: string;
  active?: boolean;
  lineType: LineType;
  label: string;
  defaultAmount: string;
  effect: "add" | "subtract" | "neutral";
  sourceType?: string | null;
  sourceReferenceId?: string | null;
  sessionValue?: number | null;
  pricingDefinitionId?: string | null;
};
type Profile = {
  id: string;
  name: string;
  sessionNumber: SessionNumber | null;
  sessionId: string | null;
  sessionName: string | null;
  isBase: boolean;
  active: boolean;
  version: number;
  procedures: Procedure[];
  lines: Line[];
};
type SourceCategory = {
  id: string;
  name: string;
  fieldId: string;
  stableKey: string;
  sourceType: string;
  catalogSource: string | null;
  multiple: boolean;
  supportsSpecific: boolean;
  defaultEffect: Line["effect"];
};

const effectLabels: Record<Line["effect"], string> = { add: "إضافة", subtract: "خصم", neutral: "محايد" };
const blankLine = (): Line => ({ lineType: "fixed_cost", label: "", defaultAmount: "", effect: "subtract", sourceType: null, sourceReferenceId: null, sessionValue: null });
const sessionLabel = (value: SessionNumber | null, name?:string|null) => name || (value == null ? "قائمة قديمة — بدون جلسة محددة" : `الجلسة رقم ${value}`);
const sessionWorkspaceLabel = (session: Session) => session.sessionNumber === 1
  ? "جلسة التفتيت الأولى"
  : session.sessionNumber === 2
    ? "جلسة التفتيت الثانية"
    : session.name;
const procedureOptionLabel = (profile: Profile) => profile.procedures.length
  ? profile.procedures.map((procedure) => procedure.name).join(" + ")
  : profile.name;
const activeLines = (profile: Profile) => {
  const active = profile.lines.filter((line) => line.active !== false);
  return active.length ? active : profile.lines.filter((line) => !line.stableKey?.includes("__archived_"));
};

function ProcedureChips({ procedures }: { procedures: Procedure[] }) {
  return <div className="pricing-profile-procedures" aria-label="مجموعة الإجراءات">
    {procedures.length ? procedures.map((procedure, index) => <span key={procedure.id}>{procedure.name}{index < procedures.length - 1 && <i aria-hidden="true">+</i>}</span>) : <span className="is-empty">لا توجد إجراءات مسجلة</span>}
  </div>;
}

function ProfileCard({ profile, canManage, onEdit, onArchive, onRestore }: { profile: Profile; canManage: boolean; onEdit: (profile: Profile) => void; onArchive: (profile: Profile) => void; onRestore: (profile: Profile) => void }) {
  const lines = activeLines(profile);
  return <article className={`pricing-profile-card ${!profile.active ? "is-archived" : ""}`} data-profile-name={profile.name}>
    <div className="pricing-profile-card__head">
      <div><span className="pricing-profile-card__eyebrow">قائمة أسعار</span><h3>{profile.name}</h3></div>
      <div className="pricing-profile-card__badges">{profile.isBase && <span className="pricing-profile-badge">أساسي</span>}<span className={`pricing-profile-status ${profile.active ? "is-active" : ""}`}>{profile.active ? "نشط" : "مؤرشف"}</span></div>
    </div>
    <ProcedureChips procedures={profile.procedures} />
    <div className="pricing-profile-card__meta"><span>{lines.length} {lines.length === 1 ? "بند مالي" : "بنود مالية"}</span><span>الإصدار {profile.version}</span></div>
    {canManage && <footer>{profile.active ? <><button className="primary" onClick={() => onEdit(profile)}>فتح / تعديل</button><button className="danger" onClick={() => onArchive(profile)}>أرشفة</button></> : <button className="primary" onClick={() => onRestore(profile)}>استعادة</button>}</footer>}
  </article>;
}

export function LithotripsyPricingProfiles({ canManage }: { canManage: boolean }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [sessions,setSessions]=useState<Session[]>([]);
  const [selectedSessionId,setSelectedSessionId]=useState("");
  const [selectedProfileId,setSelectedProfileId]=useState("");
  const [newSessionName,setNewSessionName]=useState("");
  const [addingSession,setAddingSession]=useState(false);
  const [sourceCategories, setSourceCategories] = useState<SourceCategory[]>([]);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [name, setName] = useState("");
  const [sessionNumber, setSessionNumber] = useState<SessionNumber | null>(null);
  const [selectedProcedures, setSelectedProcedures] = useState<string[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [addingLine, setAddingLine] = useState(false);
  const [newLineSource, setNewLineSource] = useState("");
  const [isBase, setIsBase] = useState(false);
  const [showArchived, setShowArchived] = useState<Record<string, boolean>>({});
  const [showLegacy, setShowLegacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  async function load() {
    try {
      const [profilesResponse, sourcesResponse,sessionsResponse] = await Promise.all([
        fetch("/api/v1/financial-reviews/pricing-profiles/lithotripsy", { cache: "no-store" }),
        fetch("/api/v1/financial-reviews/pricing-profiles/lithotripsy/sources", { cache: "no-store" }),
        fetch("/api/v1/lithotripsy/sessions?includeArchived=true",{cache:"no-store"}),
      ]);
      const [body, sourceBody,sessionBody] = await Promise.all([profilesResponse.json().catch(() => ({})), sourcesResponse.json().catch(() => ({})),sessionsResponse.json().catch(() =>({}))]);
      if (!profilesResponse.ok) throw new Error(body.error?.message ?? "تعذر تحميل قوالب الأسعار.");
      if (!sourcesResponse.ok) throw new Error(sourceBody.error?.message ?? "تعذر تحميل مصادر البنود.");
      if (!sessionsResponse.ok) throw new Error(sessionBody.error?.message ?? "تعذر تحميل الجلسات.");
      if (mountedRef.current) { const nextSessions=Array.isArray(sessionBody.sessions)?sessionBody.sessions:[];setProfiles(Array.isArray(body.profiles) ? body.profiles : []); setSourceCategories(Array.isArray(sourceBody.sources) ? sourceBody.sources : []);setSessions(nextSessions);setSelectedSessionId(current=>current&&nextSessions.some((item:Session)=>item.id===current)?current:""); setError(""); }
    } catch (caught) { if (mountedRef.current) setError(caught instanceof Error ? caught.message : "تعذر تحميل قوالب الأسعار."); }
  }
  useEffect(() => { void load(); }, []);

  function openNew(session: Session) {
    setEditing(null); setEditorOpen(true); setName(""); setSessionNumber(session.sessionNumber); setSelectedSessionId(session.id);setSelectedProfileId("");setSelectedProcedures([]); setLines([]); setAddingLine(false); setNewLineSource(""); setIsBase(false); setError(""); setNotice("");
  }
  function openEdit(profile: Profile) {
    setEditing(profile); setEditorOpen(true); setSelectedProfileId(profile.id); setName(profile.name); setSessionNumber(profile.sessionNumber);if(profile.sessionId)setSelectedSessionId(profile.sessionId); setSelectedProcedures(profile.procedures.map((item) => item.id));
    setLines(activeLines(profile).map((line) => ({ ...line, defaultAmount: line.defaultAmount == null ? "" : String(line.defaultAmount) })));
    setAddingLine(false); setNewLineSource(""); setIsBase(profile.isBase); setError(""); setNotice("");
  }
  function closeEditor() { if (!busy) { setEditorOpen(false); setEditing(null); } }
  function updateLine(index: number, patch: Partial<Line>) { setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line)); }
  function moveLine(index: number, delta: number) { const target = index + delta; if (target < 0 || target >= lines.length) return; const next = [...lines]; [next[index], next[target]] = [next[target], next[index]]; setLines(next); }

  function sourceCategory(line: Line) { return sourceCategories.find((source) => source.sourceType === line.sourceType) ?? null; }
  function sourceChoice(line: Line) { if (line.lineType === "fixed_cost") return "fixed"; if (line.lineType === "session_cost") return "legacy"; return sourceCategory(line)?.id ?? "legacy"; }
  function setLineSource(index: number, value: string) {
    if (value === "fixed" || value === "manual") { updateLine(index, { lineType: "fixed_cost", label: "", sourceType: null, sourceReferenceId: null, sessionValue: null }); return; }
    const category = sourceCategories.find((source) => source.id === value);
    if (category) updateLine(index, { lineType: "linked_role", label: financialSourceDisplayLabel(category.name), sourceType: category.sourceType, sourceReferenceId: null, effect: category.defaultEffect, sessionValue: null });
  }
  function addSelectedLine() {
    if (!newLineSource) { setError("اختر مصدر البند أولاً."); return; }
    if (newLineSource === "fixed" || newLineSource === "manual") setLines((current) => [...current, blankLine()]);
    else {
      const category = sourceCategories.find((source) => source.id === newLineSource);
      if (!category) return;
      setLines((current) => [...current, { ...blankLine(), lineType: "linked_role", label: financialSourceDisplayLabel(category.name), sourceType: category.sourceType, effect: category.defaultEffect }]);
    }
    setAddingLine(false); setNewLineSource(""); setError("");
  }

  async function save() {
    if (sessionNumber == null || !(editing?.sessionId ?? selectedSessionId)) { setError("حدد جلسة صالحة لقائمة الأسعار."); return; }
    const identities = lines.flatMap((line) => line.lineType === "linked_role" && line.sourceType ? [`role:${line.sourceType}`] : line.lineType === "linked_source" && line.sourceType && line.sourceReferenceId ? [`source:${line.sourceType}:${line.sourceReferenceId}`] : []);
    if (new Set(identities).size !== identities.length) { setError("لا يمكن إضافة نفس المصدر المالي أكثر من مرة داخل القالب."); return; }
    setBusy(true); setError(""); setNotice("");
    const payload = { action: editing ? "update" : undefined, name, sessionId: editing?.sessionId ?? selectedSessionId, sessionNumber, procedureIds: selectedProcedures, isBase, lines: lines.map((line) => ({ ...line, defaultAmount: line.defaultAmount === "" ? null : Number(line.defaultAmount) })) };
    const response = await fetch(editing ? `/api/v1/financial-reviews/pricing-profiles/lithotripsy/${editing.id}` : "/api/v1/financial-reviews/pricing-profiles/lithotripsy", { method: editing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({})); setBusy(false);
    if (!response.ok) { setError(body.error?.message ?? "تعذر حفظ قالب الأسعار."); return; }
    setNotice("تم حفظ قائمة الأسعار."); closeEditor(); await load();
  }

  async function createSession(){setBusy(true);setError("");const response=await fetch("/api/v1/lithotripsy/sessions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:newSessionName})});const body=await response.json().catch(()=>({}));setBusy(false);if(!response.ok){setError(body.error?.message??"تعذر إنشاء الجلسة.");return;}setAddingSession(false);setNewSessionName("");setSelectedSessionId(body.session.id);setNotice("تمت إضافة الجلسة وأصبحت متاحة في نموذج الشغل.");await load();}
  async function archiveSession(session:Session){if(!confirm(`أرشفة ${session.name}؟ ستظل العمليات وقوائم الأسعار التاريخية محفوظة.`))return;setBusy(true);setError("");const response=await fetch(`/api/v1/lithotripsy/sessions/${session.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"archive"})});const body=await response.json().catch(()=>({}));setBusy(false);if(!response.ok){setError(body.error?.message??"تعذر أرشفة الجلسة.");return;}setNotice("تمت أرشفة الجلسة وإخفاؤها من نموذج إضافة الشغل.");await load();}
  async function restoreSession(session:Session){setBusy(true);setError("");const response=await fetch(`/api/v1/lithotripsy/sessions/${session.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"restore"})});const body=await response.json().catch(()=>({}));setBusy(false);if(!response.ok){setError(body.error?.message??"تعذر استعادة الجلسة.");return;}setSelectedSessionId(session.id);setNotice("تمت استعادة الجلسة وأصبحت متاحة في نموذج إضافة الشغل.");await load();}
  async function mutateState(profile: Profile, action: "archive" | "restore") {
    if (action === "archive" && !confirm("أرشفة قائمة الأسعار؟ ستبقى المراجعات التاريخية محفوظة.")) return;
    setError("");
    const response = await fetch(`/api/v1/financial-reviews/pricing-profiles/lithotripsy/${profile.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error?.message ?? "تعذر تحديث حالة القالب.");
    else { setNotice(action === "archive" ? "تمت أرشفة القالب." : "تمت استعادة القالب."); await load(); }
  }

  const renderSession = (session: Session) => {
    const active = profiles.filter((profile) => (profile.sessionId===session.id || (!profile.sessionId&&profile.sessionNumber === session.sessionNumber)) && profile.active);
    const archived = profiles.filter((profile) => (profile.sessionId===session.id || (!profile.sessionId&&profile.sessionNumber === session.sessionNumber)) && !profile.active);
    const selectedProfile = active.find((profile) => profile.id === selectedProfileId) ?? null;
    return <section key={session.id} className="pricing-session" aria-labelledby={`session-${session.id}-title`} data-session={session.sessionNumber}>
      <button className="pricing-session__back" onClick={() => { setSelectedSessionId(""); setSelectedProfileId(""); }}>← كل جلسات التفتيت</button>
      <header className="pricing-session__header"><div className="pricing-session__identity"><span>{session.sessionNumber}</span><div><small>أنت الآن داخل</small><h2 id={`session-${session.id}-title`}>{sessionWorkspaceLabel(session)}</h2><p>{active.length} {active.length === 1 ? "قائمة أسعار نشطة" : "قوائم أسعار نشطة"} · اختر نوع العملية لعرض بنوده وأسعاره فقط.</p></div></div>{canManage && <div className="pricing-session__actions"><button className="primary" onClick={() => openNew(session)}>+ إضافة قائمة أسعار</button><button className="danger" disabled={busy||active.length>0} title={active.length?"أرشف قوائم الأسعار النشطة أولاً":"أرشفة الجلسة"} onClick={()=>void archiveSession(session)}>أرشفة الجلسة</button></div>}</header>
      {active.length ? <div className={`litho-pricing-master-detail ${selectedProfile ? "has-selection" : ""}`}><aside aria-label="قوائم أسعار الجلسة"><header><span>الخطوة الثانية</span><h3>اختر نوع العملية</h3></header>{active.map((profile) => <button className={selectedProfile?.id === profile.id ? "active" : ""} key={profile.id} onClick={() => setSelectedProfileId(profile.id)}><strong>{procedureOptionLabel(profile)}</strong><small>{activeLines(profile).length} بنود · الإصدار {profile.version}</small><span aria-hidden="true">←</span></button>)}</aside><section className="litho-pricing-detail">{selectedProfile ? <><button className="pricing-mobile-back" onClick={() => setSelectedProfileId("")}>→ أنواع العمليات</button><header><div><span>قائمة الأسعار</span><h3>{selectedProfile.name}</h3><ProcedureChips procedures={selectedProfile.procedures} /></div><div><button className="primary" onClick={() => openEdit(selectedProfile)}>فتح وتعديل البنود</button><button className="danger" onClick={() => void mutateState(selectedProfile, "archive")}>أرشفة القائمة</button></div></header><div className="litho-pricing-detail__items">{activeLines(selectedProfile).map((line) => <article key={line.id ?? line.stableKey}><div><span>{line.lineType === "linked_source" ? "بند مسجل" : line.lineType === "linked_role" ? "افتراضي للفئة" : "بند مالي ثابت"}</span><strong>{line.label}</strong></div><b>{line.defaultAmount === "" || line.defaultAmount == null ? "غير محدد" : `${line.defaultAmount} ج.م`}</b><small>{effectLabels[line.effect]}</small></article>)}{!activeLines(selectedProfile).length && <div className="pricing-empty-state">لا توجد بنود مالية في هذه القائمة.</div>}</div></> : <div className="pricing-detail-placeholder"><span>←</span><strong>اختر نوع العملية</strong><small>ستظهر بنوده وأسعاره هنا.</small></div>}</section></div> : <div className="pricing-session__empty"><strong>لا توجد قوائم أسعار في {session.name} حتى الآن.</strong><p>ابدأ بقائمة مرتبطة بمجموعة إجراءات واضحة.</p>{canManage && <button onClick={() => openNew(session)}>+ إضافة قائمة أسعار</button>}</div>}
      {archived.length > 0 && <div className="pricing-archived"><button className="pricing-archived__toggle" aria-expanded={showArchived[session.id]} onClick={() => setShowArchived((current) => ({ ...current, [session.id]: !current[session.id] }))}>{showArchived[session.id] ? "إخفاء المؤرشف" : `عرض المؤرشف (${archived.length})`}</button>{showArchived[session.id] && <div className="pricing-session__templates is-archived-list">{archived.map((profile) => <ProfileCard key={profile.id} profile={profile} canManage={canManage} onEdit={openEdit} onArchive={(item) => void mutateState(item, "archive")} onRestore={(item) => void mutateState(item, "restore")} />)}</div>}</div>}
    </section>;
  };
  const legacy = profiles.filter((profile) => profile.sessionNumber == null);
  const activeSessions = sessions.filter((item) => item.active);

  return <main className="litho-pricing-profiles" dir="rtl">
    <header className="pricing-profiles-hero"><div><nav aria-label="مسار الصفحة"><Link href="/accounts/pricing">بنود وأسعار</Link><span aria-hidden="true">/</span><span>التفتيت</span></nav><h1>بنود وأسعار التفتيت</h1><p>اختر الجلسة، ثم افتح قائمة الأسعار المرتبطة بالإجراءات وعدّل بنودها.</p></div><aside><span>نموذج التسعير</span><b>الجلسة ← قائمة الأسعار ← البنود</b></aside></header>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-success" role="status">{notice}</p>}
    {!selectedSessionId && <section className="pricing-session-landing" aria-label="جلسات تسعير التفتيت"><header><div><span>الخطوة الأولى</span><h2>اختر جلسة التفتيت</h2><p>كل جلسة تحتوي قوائم عمليات مستقلة، وكل قائمة تحتوي بنودها وأسعارها فقط.</p></div>{canManage&&<button className="pricing-session-landing__add" onClick={()=>setAddingSession(true)}>+ إنشاء جلسة جديدة</button>}</header><div className="pricing-session-overview-grid">{activeSessions.map(session=>{const sessionProfiles=profiles.filter(profile=>profile.active&&(profile.sessionId===session.id||(!profile.sessionId&&profile.sessionNumber===session.sessionNumber)));return <article className="pricing-session-overview-card" key={session.id} data-session={session.sessionNumber}><div className="pricing-session-overview-card__number">{session.sessionNumber}</div><div className="pricing-session-overview-card__body"><span>جلسة تسعير</span><h3>{sessionWorkspaceLabel(session)}</h3><strong>{sessionProfiles.length} {sessionProfiles.length===1?"قائمة أسعار":"قوائم أسعار"}</strong><p>{sessionProfiles.length?sessionProfiles.slice(0,3).map(procedureOptionLabel).join(" · "):"لا توجد قوائم أسعار بعد"}</p></div><button onClick={()=>setSelectedSessionId(session.id)}>فتح الجلسة <span aria-hidden="true">←</span></button></article>})}</div></section>}
    {addingSession&&<section className="pricing-add-session"><label>اسم الجلسة<input autoFocus value={newSessionName} onChange={event=>setNewSessionName(event.target.value)} placeholder="مثال: الجلسة الثالثة" /></label><button onClick={()=>setAddingSession(false)}>إلغاء</button><button className="primary" disabled={busy||newSessionName.trim().length<2} onClick={()=>void createSession()}>حفظ الجلسة</button></section>}
    <div className="pricing-session-library">{activeSessions.filter(item=>item.id===selectedSessionId).map(renderSession)}</div>
    {!selectedSessionId && sessions.some(item=>!item.active)&&<section className="pricing-archived-sessions"><strong>الجلسات المؤرشفة</strong><div>{sessions.filter(item=>!item.active).map(session=><article key={session.id}><span>{session.name}</span>{canManage&&<button disabled={busy} onClick={()=>void restoreSession(session)}>استعادة</button>}</article>)}</div></section>}
    {!selectedSessionId && legacy.length > 0 && <section className="pricing-legacy"><button aria-expanded={showLegacy} onClick={() => setShowLegacy((current) => !current)}><span><strong>بنود قديمة / توافق تاريخي</strong><small>{legacy.length} قوالب بدون جلسة محددة، محفوظة للقراءة التاريخية ولا تمثل هيكل التسعير الحالي.</small></span><b>{showLegacy ? "إخفاء" : "عرض"}</b></button>{showLegacy && <div className="pricing-session__templates">{legacy.map((profile) => <ProfileCard key={profile.id} profile={profile} canManage={canManage} onEdit={openEdit} onArchive={(item) => void mutateState(item, "archive")} onRestore={(item) => void mutateState(item, "restore")} />)}</div>}</section>}
    {canManage && editorOpen && <section className="pricing-profile-editor" aria-label="محرر قالب الأسعار">
      <header><div><span>{editing ? "تعديل قائمة الأسعار" : "قائمة أسعار جديدة"}</span><h2>{sessionLabel(sessionNumber,editing?.sessionName??sessions.find(item=>item.id===selectedSessionId)?.name)}</h2><p>{editing ? "راجع بيانات القائمة وإجراءاتها وبنودها المالية." : "الجلسة محددة من مكان إضافة القائمة داخل المكتبة."}</p></div><button aria-label="إغلاق" onClick={closeEditor}>×</button></header>
      {editing && editing.sessionNumber == null && <p className="review-fallback-warning">قالب قديم — بدون جلسة محددة. اختر جلسة صريحة فقط إذا كان تحويله مقصودًا.</p>}
      <section className="pricing-editor-section"><div className="pricing-editor-section__title"><span>A</span><div><h3>بيانات القائمة</h3><small>الاسم للعرض فقط؛ هوية المطابقة تعتمد على الجلسة والإجراءات.</small></div></div><label>اسم القائمة<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="مثال: تفتيت + تركيب" /></label>{editing && editing.sessionNumber == null ? <label>الجلسة<select value={sessionNumber ?? ""} onChange={(event) => setSessionNumber(event.target.value ? Number(event.target.value) as SessionNumber : null)}><option value="">بدون جلسة محددة</option>{sessions.filter(item=>item.active).map(item=><option key={item.id} value={item.sessionNumber}>{item.name}</option>)}</select></label> : <div className="pricing-editor-session-lock"><span>الجلسة</span><strong>{sessionLabel(sessionNumber,editing?.sessionName??sessions.find(item=>item.id===selectedSessionId)?.name)}</strong><small>ثابتة داخل هذه القائمة لتجنب النقل غير المقصود.</small></div>}<div className="pricing-profile-editor__base"><label><input type="checkbox" checked={isBase} onChange={(event) => setIsBase(event.target.checked)} /> القائمة الأساسية لهذه الجلسة</label><small>تُستخدم فقط عند عدم وجود قائمة مطابقة داخل الجلسة نفسها.</small></div></section>
      <section className="pricing-editor-section"><div className="pricing-editor-section__title"><span>B</span><div><h3>الإجراءات</h3><small>اختر مجموعة الإجراءات الدقيقة؛ الترتيب لا يغيّر هوية المطابقة.</small></div></div><SmartSelect label="الإجراءات المرتبطة" type="procedures" optionsEndpoint="/api/v1/work-forms/references/procedures" value={selectedProcedures} multiple canManage={false} onChange={(value) => setSelectedProcedures(value as string[])} /></section>
      <section className="pricing-editor-section pricing-editor-lines"><div className="pricing-profile-lines-heading"><div className="pricing-editor-section__title"><span>C</span><div><h3>البنود والأسعار</h3><small>اربط السعر بمصدر العملية متى أمكن؛ الجلسة ليست بند تكلفة.</small></div></div><button onClick={() => { setAddingLine((current) => !current); setNewLineSource(""); }}>+ إضافة بند</button></div>
        {addingLine && <div className="financial-source-creator"><div><strong>ما نوع البند؟</strong><small>ابحث في مصادر نموذج التفتيت أو اختر بندًا ثابتًا.</small></div><SmartSelect label="مصدر البند" type="financial-source-category" value={newLineSource} optionsEndpoint="/api/v1/financial-reviews/pricing-profiles/lithotripsy/sources" canManage={false} onChange={(value) => setNewLineSource(value as string)} /><footer><button onClick={() => { setAddingLine(false); setNewLineSource(""); }}>إلغاء</button><button className="primary" disabled={!newLineSource} onClick={addSelectedLine}>متابعة</button></footer></div>}
        <div className="pricing-profile-lines-list">{lines.map((line, index) => {
          const category = sourceCategory(line), choice = sourceChoice(line), isLegacy = choice === "legacy";
          return <article className={`pricing-profile-line-editor ${isLegacy ? "is-legacy" : ""}`} key={line.id ?? `${line.stableKey}-${index}`}>
            <div className="pricing-profile-line-editor__top"><div><span>{index + 1}</span><strong>{line.label.trim() || "بند مالي مخصص"}</strong><small>{isLegacy ? "بند قديم" : category ? `${category.name} · ${line.lineType === "linked_source" ? "عنصر محدد" : "افتراضي للفئة"}` : "بند مالي ثابت"} · {effectLabels[line.effect]}</small></div><div><button aria-label="تحريك لأعلى" disabled={index === 0} onClick={() => moveLine(index, -1)}>↑</button><button aria-label="تحريك لأسفل" disabled={index === lines.length - 1} onClick={() => moveLine(index, 1)}>↓</button><button className="danger" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}>حذف</button></div></div>
            {isLegacy ? <div className="legacy-source-line"><span>بند قديم — لم يُعدّل مصدره تلقائيًا</span><label>اسم العرض<input value={line.label} onChange={(event) => updateLine(index, { label: event.target.value })} /></label></div> : <div className="financial-source-fields">
              <SmartSelect label="مصدر البند" type="financial-source-category" value={choice} optionsEndpoint="/api/v1/financial-reviews/pricing-profiles/lithotripsy/sources" canManage={false} onChange={(value) => setLineSource(index, value as string)} />
              {category && category.supportsSpecific && <label>النطاق<select value={line.lineType === "linked_source" ? "specific" : "generic"} onChange={(event) => { const specific = event.target.value === "specific"; updateLine(index, { lineType: specific ? "linked_source" : "linked_role", sourceReferenceId: null, label: specific ? `${category.name} — اختر العنصر` : financialSourceDisplayLabel(category.name) }); }}><option value="generic">أي {category.name}</option><option value="specific">عنصر / شخص محدد</option></select></label>}
              {category && line.lineType === "linked_source" && category.catalogSource && <SmartSelect label={`اختيار ${category.name}`} type={category.catalogSource} value={line.sourceReferenceId ?? ""} optionsEndpoint={`/api/v1/work-forms/references/${category.catalogSource}`} canManage={false} onChange={(value) => updateLine(index, { sourceReferenceId: value as string })} onOptionChange={(option) => updateLine(index, { label: option ? financialSourceDisplayLabel(category.name, option.name) : `${category.name} — اختر العنصر` })} />}
              {!category && <label>اسم البند<input value={line.label} onChange={(event) => updateLine(index, { label: event.target.value })} placeholder="مثال: تمريض وعمال" /></label>}
            </div>}
            <div className="financial-source-pricing"><label>السعر الافتراضي<MoneyInput value={line.defaultAmount} ariaLabel={`السعر الافتراضي للبند ${index + 1}`} placeholder="أدخل المبلغ" onChange={(value) => updateLine(index, { defaultAmount: value ?? "" })} /></label><label>التأثير<select value={line.effect} onChange={(event) => updateLine(index, { effect: event.target.value as Line["effect"] })}><option value="subtract">خصم</option><option value="add">إضافة</option><option value="neutral">محايد</option></select></label></div>
            {line.lineType === "session_cost" && <p className="review-fallback-warning">هذا بند مالي قديم محفوظ للتوافق، وليس محدد جلسة القالب.</p>}
          </article>;
        })}{!lines.length && !addingLine && <div className="pricing-lines-empty"><div><strong>لا توجد بنود مالية بعد.</strong><small>ابدأ بمصدر من نموذج العملية أو ببند مالي ثابت.</small></div><button onClick={() => setAddingLine(true)}>+ إضافة أول بند</button></div>}</div>
      </section>
      <footer><div><span>D</span><strong>حفظ القالب</strong></div><button onClick={closeEditor}>إلغاء</button><button className="primary" disabled={busy || sessionNumber == null || name.trim().length < 2 || selectedProcedures.length === 0} onClick={() => void save()}>{busy ? "جارٍ الحفظ..." : "حفظ القالب"}</button></footer>
    </section>}
  </main>;
}
