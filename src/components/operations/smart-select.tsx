/* eslint-disable react-hooks/exhaustive-deps */
"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";

export type SmartOption = { id: string; name: string };
type Props = {
  label: string;
  type: string;
  value: string | string[];
  multiple?: boolean;
  canManage: boolean;
  maxSelections?: number | null;
  optionsEndpoint?: string;
  returnLabel?: boolean;
  onChange: (value: string | string[]) => void;
  onOptionChange?: (option: SmartOption | null) => void;
};
const defaults: Record<string, Record<string, unknown>> = {
  procedures: { category: "عام" }, equipment: { equipmentType: "عام" },
  stents: { stentType: "عام" }, "contract-entities": { entityType: "other" },
  "anesthesia-types": {}, "financial-items": { defaultKind: "financial", defaultAmount: 0 },
};

export function SmartSelect({ label, type, value, multiple = false, canManage, maxSelections = null, optionsEndpoint, returnLabel = false, onChange, onOptionChange }: Props) {
  const menuId = useId();
  const [options, setOptions] = useState<SmartOption[]>([]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<{ mode: "add" | "edit"; id?: string; name: string } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => options.filter((option) => multiple ? (value as string[]).includes(option.id) : value === option.id || (returnLabel && value === option.name)), [options, value, multiple, returnLabel]);

  async function load() {
    const response = await fetch(optionsEndpoint ?? `/api/v1/catalogs/${type}?active=true&limit=50`);
    if (response.ok) setOptions((await response.json()).items ?? []);
  }
  useEffect(() => { queueMicrotask(() => void load()); }, [type, optionsEndpoint]);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) { setOpen(false); setSearch(""); } };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const normalizedSearch = search.trim().replace(/\s+/gu, " ");
  const visible = options.filter((option) => option.name.toLocaleLowerCase().includes(normalizedSearch.toLocaleLowerCase()));
  const exact = options.find((option) => option.name.trim().toLocaleLowerCase() === normalizedSearch.toLocaleLowerCase());
  function choose(id: string) {
    if (multiple) {
      const current = value as string[];
      if (!current.includes(id) && maxSelections != null && current.length >= maxSelections) { alert(`الحد الأقصى للاختيارات هو ${maxSelections}.`); return; }
      onChange(current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
      setSearch(""); setActiveIndex(0);
      setOpen(true);
    } else { const option = options.find((item) => item.id === id) ?? null; onChange(returnLabel ? option?.name ?? "" : id); onOptionChange?.(option); setSearch(""); setActiveIndex(0); setOpen(false); }
  }
  function clearSingle() { if (!multiple) { onChange(""); onOptionChange?.(null); setSearch(""); setOpen(true); } }
  function removeChip(id: string) { if (multiple) onChange((value as string[]).filter((item) => item !== id)); }
  async function createOption(rawName: string) {
    const name = rawName.trim().replace(/\s+/gu, " ");
    if (name.length < 2 || busy) return;
    setBusy(true);
    const response = await fetch(`/api/v1/catalogs/${type}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, ...(defaults[type] ?? {}) }) });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok || !body.item?.id) { alert(body.error?.message ?? "تعذر إضافة العنصر"); return; }
    setOptions((current) => [...current, body.item]);
    onChange(multiple ? [...(value as string[]), body.item.id] : returnLabel ? body.item.name : body.item.id);
    setSearch(""); setOpen(!multiple);
  }
  function startAdd() { void createOption(normalizedSearch); }
  async function saveOption() {
    if (!editor) return;
    const name = editor.name.trim().replace(/\s+/gu, " ");
    if (name.length < 2) return;
    setBusy(true);
    const response = await fetch(editor.mode === "edit" ? `/api/v1/catalogs/${type}/${editor.id}` : `/api/v1/catalogs/${type}`, {
      method: editor.mode === "edit" ? "PATCH" : "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(editor.mode === "edit" ? { name } : { name, ...(defaults[type] ?? {}) }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok || !body.item?.id) { alert(body.error?.message ?? "تعذر حفظ العنصر"); return; }
    setOptions((current) => editor.mode === "edit" ? current.map((item) => item.id === body.item.id ? body.item : item) : [...current, body.item]);
    if (editor.mode === "add") onChange(multiple ? [...(value as string[]), body.item.id] : body.item.id);
    setEditor(null); setSearch(""); setOpen(!multiple);
  }
  async function archive(id: string) {
    if (!confirm("أرشفة هذا الخيار؟ سيظل محفوظاً في السجلات السابقة.")) return;
    const response = await fetch(`/api/v1/catalogs/${type}/${id}/archive`, { method: "POST" });
    if (!response.ok) { alert((await response.json().catch(() => ({}))).error?.message ?? "تعذر أرشفة العنصر"); return; }
    setOptions((current) => current.filter((option) => option.id !== id));
    // Archiving is a catalog action; only remove it from the current form if it was selected.
    if (multiple) onChange((value as string[]).filter((item) => item !== id)); else if (value === id) onChange("");
  }
  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") { setOpen(false); setSearch(""); return; }
    if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActiveIndex((current) => Math.min(current + 1, Math.max(visible.length - 1, 0))); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setActiveIndex((current) => Math.max(current - 1, 0)); return; }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const keyboardChoice = exact ?? visible[activeIndex];
    if (keyboardChoice) choose(keyboardChoice.id); else if (canManage && normalizedSearch.length >= 2) startAdd();
  }
  const inputValue = multiple ? search : open ? search : selected[0]?.name ?? "";
  return <div className="smart-select" ref={root}>
    {label && <label>{label}</label>}
    <div className={`smart-select__control ${open ? "is-open" : ""}`}>
      {multiple && <span className="smart-select__chips">{selected.map((option) => <span className="smart-select__chip" key={option.id}>{option.name}<button type="button" aria-label={`إزالة ${option.name}`} onClick={() => removeChip(option.id)}>×</button></span>)}</span>}
      <input role="combobox" className={multiple ? "smart-select__input smart-select__input--multi" : "smart-select__input smart-select__input--single"} value={inputValue} placeholder={multiple && selected.length ? "إضافة اختيار..." : `اكتب أو اختر ${label || "..."}`} onFocus={() => { setOpen(true); setActiveIndex(0); if (!multiple) setSearch(""); }} onChange={(event) => { setSearch(event.target.value); setActiveIndex(0); setOpen(true); }} onKeyDown={onInputKeyDown} aria-autocomplete="list" aria-controls={menuId} aria-expanded={open} aria-activedescendant={open && visible[activeIndex] ? `smart-option-${visible[activeIndex].id}` : undefined} />
      {!multiple && selected.length > 0 && <button type="button" className="smart-select__clear" aria-label="مسح الاختيار" onClick={clearSingle}>×</button>}
      <button type="button" className="smart-select__arrow" aria-label="فتح القائمة" onClick={() => setOpen((current) => !current)}>⌄</button>
    </div>
    {multiple && selected.length > 0 && <button type="button" className="smart-select__clear-all" onClick={() => onChange([])}>مسح الكل</button>}
    {open && <div className="smart-select__menu" id={menuId} role="listbox">
      {visible.length ? visible.map((option, index) => <div className={`smart-select__option ${index === activeIndex ? "is-active" : ""}`} id={`smart-option-${option.id}`} key={option.id}>
        <button type="button" onClick={() => choose(option.id)}>{multiple && <span>{(value as string[]).includes(option.id) ? "☑" : "☐"}</span>}{option.name}</button>
        {canManage && <><button type="button" className="smart-select__edit" aria-label={`تعديل ${option.name}`} onClick={() => setEditor({ mode: "edit", id: option.id, name: option.name })}>✎</button><button type="button" className="smart-select__archive" aria-label={`أرشفة ${option.name}`} onClick={() => void archive(option.id)}>أرشفة</button></>}
      </div>) : <p>لا توجد نتائج.</p>}
      {canManage && normalizedSearch.length >= 2 && !exact && <button disabled={busy} type="button" className="smart-select__add" onClick={startAdd}>+ إضافة &quot;{normalizedSearch}&quot;</button>}
      {editor && <div className="smart-select__editor" role="dialog" aria-label={editor.mode === "edit" ? "تعديل الخيار" : "إضافة خيار جديد"}><strong>{editor.mode === "edit" ? "تعديل الخيار" : "إضافة خيار جديد"}</strong><label>اسم العنصر<input autoFocus value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></label><div><button type="button" onClick={() => setEditor(null)}>إلغاء</button><button type="button" className="primary" disabled={busy || editor.name.trim().length < 2} onClick={() => void saveOption()}>{editor.mode === "edit" ? "حفظ" : "إضافة"}</button></div></div>}
    </div>}
  </div>;
}
