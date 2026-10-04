"use client";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useAuthenticatedRequestScope } from "@/components/auth/request-scope-provider";
import { observeMenuGeometry, revealMenuRow } from "./smart-select-geometry";
import { useSharedReference } from "@/lib/shared-references";
import { formatCatalogName, normalizeCatalogName } from "@/lib/catalogs/normalize-name";
import { resolveInlineReferenceSource, type InlineReferenceSource } from "@/lib/work-forms/inline-reference-sources";

export type SmartOption = { id: string; name: string };
type Props = {
  label: string;
  accessibleLabel?: string;
  type: string;
  value: string | string[];
  multiple?: boolean;
  canCreate?: boolean;
  inlineCreateSource?: InlineReferenceSource;
  canManage: boolean;
  maxSelections?: number | null;
  optionsEndpoint?: string;
  returnLabel?: boolean;
  onChange: (value: string | string[]) => void;
  onOptionChange?: (option: SmartOption | null) => void;
};
const emptyOptions: SmartOption[] = [];
const defaults: Record<string, Record<string, unknown>> = {
  procedures: { category: "عام" }, equipment: { equipmentType: "عام" },
  stents: { stentType: "عام" }, "contract-entities": { entityType: "other" },
  "anesthesia-types": {}, "financial-items": { defaultKind: "financial", defaultAmount: 0 },
};

export function SmartSelect({ label, accessibleLabel, type, value, multiple = false, canCreate = false, inlineCreateSource, canManage, maxSelections = null, optionsEndpoint, returnLabel = false, onChange, onOptionChange }: Props) {
  const menuId = useId();
  const control = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const restoringFocus = useRef(false);
  const endpoint = optionsEndpoint ?? `/api/v1/catalogs/${type}?active=true&limit=50`;
  const references = useSharedReference(endpoint);
  const options = references.data ?? emptyOptions;
  // Only selected labels are retained locally, never a second full-response cache.
  const [remembered, setRemembered] = useState<{ key: string | null; items: SmartOption[] }>({ key: null, items: [] });
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<{ id: string; name: string; key: string | null } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const mutationVersion = useRef(0);
  const creating = useRef(false);
  const inlineSource = inlineCreateSource ? resolveInlineReferenceSource(inlineCreateSource) : null;
  // Capabilities come from the parent workflow; SmartSelect never infers them
  // from operations.create. Existing catalog workflows retain catalog POSTs.
  const createAllowed = canCreate && (inlineCreateSource ? inlineSource?.catalog === type : canManage);
  const selection = useRef({ value, multiple, maxSelections, returnLabel, onChange, onOptionChange });
  useLayoutEffect(() => { selection.current = { value, multiple, maxSelections, returnLabel, onChange, onOptionChange }; });
  useEffect(() => () => { mutationVersion.current++; }, [endpoint, type, inlineCreateSource, createAllowed]);
  const selected = useMemo(() => {
    if (!references.key) return [];
    const candidates = [...options, ...(remembered.key === references.key ? remembered.items : [])];
    return candidates.filter((option, index) => candidates.findIndex(item => item.id === option.id) === index &&
      (multiple ? (value as string[]).includes(option.id) : value === option.id || (returnLabel && value === option.name)));
  }, [options, remembered, references.key, value, multiple, returnLabel]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) setRemembered(current => current.key === references.key &&
      JSON.stringify(current.items) === JSON.stringify(selected) ? current : { key: references.key, items: selected }); });
    return () => { active = false; };
  }, [selected, references.key]);
  const { refreshIfStale } = references;
  const { capture, isCurrent, deny } = useAuthenticatedRequestScope();
  function rememberOption(item: SmartOption) {
    setRemembered({ key: references.key, items: [...selected.filter(option => option.id !== item.id), { id: item.id, name: item.name }] });
  }
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target) && !menu.current?.contains(event.target)) {
        setOpen(false); setSearch(""); setEditor(null);
      }
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  useLayoutEffect(() => {
    if (!open || !control.current || !menu.current || !content.current) return;
    return observeMenuGeometry(control.current, menu.current, content.current);
  }, [open]);

  const normalizedSearch = formatCatalogName(search);
  const searchKey = normalizeCatalogName(search);
  const visible = options.filter((option) => normalizeCatalogName(option.name).includes(searchKey));
  const exact = options.find((option) => normalizeCatalogName(option.name) === searchKey);
  function hasSelectionCapacity(id?: string) {
    const current = selection.current;
    return !current.multiple || (id !== undefined && (current.value as string[]).includes(id)) ||
      current.maxSelections == null || (current.value as string[]).length < current.maxSelections;
  }
  function selectOption(option: SmartOption, toggle: boolean) {
    const current = selection.current;
    if (!hasSelectionCapacity(option.id)) { alert(`الحد الأقصى للاختيارات هو ${current.maxSelections}.`); return false; }
    if (current.multiple) {
      const ids = current.value as string[];
      current.onChange(ids.includes(option.id) ? (toggle ? ids.filter(id => id !== option.id) : ids) : [...ids, option.id]);
    } else {
      current.onChange(current.returnLabel ? option.name : option.id);
      current.onOptionChange?.(option);
    }
    setSearch(""); setActiveIndex(-1); setOpen(current.multiple);
    return true;
  }
  function choose(id: string) {
    const option = options.find(item => item.id === id);
    if (option) selectOption(option, true);
  }
  function clearSingle() { if (!multiple) { onChange(""); onOptionChange?.(null); setSearch(""); setOpen(true); } }
  function removeChip(id: string) { if (multiple) onChange((value as string[]).filter((item) => item !== id)); }
  async function createOption(rawName: string) {
    const name = formatCatalogName(rawName);
    if (!createAllowed || name.length < 2 || busy || creating.current ||
      options.some(option => normalizeCatalogName(option.name) === normalizeCatalogName(name))) return;
    if (!hasSelectionCapacity()) { alert(`الحد الأقصى للاختيارات هو ${selection.current.maxSelections}.`); return; }
    const ticket = capture(); if (!ticket) return;
    const mutation = mutationVersion.current;
    creating.current = true; setBusy(true);
    try {
      const response = await fetch(inlineSource ? `/api/v1/work-forms/references/${inlineSource.source}` : `/api/v1/catalogs/${type}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(inlineSource ? { name } : { name, ...(defaults[type] ?? {}) }),
      });
      if (!isCurrent(ticket) || mutation !== mutationVersion.current) return;
      if ([401, 403].includes(response.status)) { deny(); return; }
      const body = await response.json().catch(() => ({}));
      if (!isCurrent(ticket) || mutation !== mutationVersion.current) return;
      const item = inlineSource ? body : body.item;
      if (!response.ok || typeof item?.id !== "string" || typeof item?.name !== "string") {
        alert(body.error?.message ?? "تعذر إضافة العنصر"); return;
      }
      void references.invalidateCatalog(type, ticket);
      // Recheck current selection after the POST: another choice may have filled
      // the field meanwhile. Never append a duplicate or exceed its current max.
      if (selectOption(item, false)) rememberOption(item);
    } catch {
      if (isCurrent(ticket) && mutation === mutationVersion.current) alert("تعذر تأكيد إضافة العنصر. تحقق من القائمة قبل إعادة المحاولة.");
    } finally {
      creating.current = false; setBusy(false);
    }
  }
  function startAdd() { focusInput(); setActiveIndex(-1); void createOption(normalizedSearch); }
  async function saveOption() {
    if (!canManage || !editor || editor.key !== references.key) return;
    const name = editor.name.trim().replace(/\s+/gu, " ");
    if (name.length < 2) return;
    const ticket = capture(); if (!ticket) return;
    const mutation = mutationVersion.current;
    setBusy(true);
    const response = await fetch(`/api/v1/catalogs/${type}/${editor.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!isCurrent(ticket) || mutation !== mutationVersion.current) { setBusy(false); return; }
    if ([401, 403].includes(response.status)) { setBusy(false); deny(); return; }
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!isCurrent(ticket) || mutation !== mutationVersion.current) return;
    if (!response.ok || !body.item?.id) { alert(body.error?.message ?? "تعذر حفظ العنصر"); return; }
    rememberOption(body.item);
    void references.invalidateCatalog(type, ticket);
    setEditor(null); setSearch(""); setOpen(!multiple);
  }
  async function archive(id: string) {
    if (!canManage) return;
    if (!confirm("أرشفة هذا الخيار؟ سيظل محفوظاً في السجلات السابقة.")) return;
    const ticket = capture(); if (!ticket) return;
    const mutation = mutationVersion.current;
    const response = await fetch(`/api/v1/catalogs/${type}/${id}/archive`, { method: "POST" });
    if (!isCurrent(ticket) || mutation !== mutationVersion.current) return;
    if ([401, 403].includes(response.status)) { deny(); return; }
    if (!response.ok) { alert((await response.json().catch(() => ({}))).error?.message ?? "تعذر أرشفة العنصر"); return; }
    void references.invalidateCatalog(type, ticket);
    // Keep the user's selected ID/label. Archiving changes available options;
    // existing server validation still decides whether a new operation may use it.
  }
  const showAdd = createAllowed && !busy && normalizedSearch.length >= 2 && !exact;
  const rowCount = visible.length + (showAdd ? 1 : 0);
  const active = activeIndex >= 0 && activeIndex < rowCount ? activeIndex : -1;
  const activeOption = active >= 0 ? visible[active] : undefined;
  const activeId = activeOption ? `${menuId}-option-${activeOption.id}` : showAdd && active === visible.length ? `${menuId}-add` : undefined;
  useLayoutEffect(() => {
    if (!open || !activeId || !results.current) return;
    const row = document.getElementById(activeId);
    if (row && results.current.contains(row)) revealMenuRow(results.current, row);
  }, [open, activeId]);

  function focusInput() {
    restoringFocus.current = true;
    input.current?.focus({ preventScroll: true });
    restoringFocus.current = false;
  }
  function closeMenu() {
    setOpen(false); setSearch(""); setEditor(null); setActiveIndex(-1);
  }
  function moveHighlight(next: number) {
    setActiveIndex(next);
    if (showAdd && next === visible.length) addButton.current?.focus({ preventScroll: true });
    else focusInput();
  }
  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    // Do not interpret IME confirmation as a selection or a form submission.
    if (event.nativeEvent?.isComposing || event.keyCode === 229) {
      if (event.key === "Enter") event.preventDefault();
      return;
    }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenu(); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) refreshIfStale();
      setOpen(true);
      const next = event.key === "ArrowDown"
        ? Math.min(!open ? 0 : active + 1, rowCount - 1)
        : active < 0 || !open ? rowCount - 1 : Math.max(0, active - 1);
      // On first open the Add button is mounted after this event. Its layout
      // effect below completes focus without scrolling the document.
      moveHighlight(next);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!open) return;
    if (activeOption) choose(activeOption.id);
    else if (showAdd && active === visible.length) startAdd();
  }
  useLayoutEffect(() => {
    if (open && showAdd && active === visible.length && document.activeElement === input.current) {
      addButton.current?.focus({ preventScroll: true });
    }
  }, [open, showAdd, active, visible.length]);
  const inputValue = multiple || open ? search : selected[0]?.name ?? "";
  const selectionLabel = accessibleLabel || label || "اختيار عنصر";
  return <div className="smart-select" ref={root} data-open={open} dir="rtl"
    onBlur={event => {
      if (event.relatedTarget instanceof Node && root.current?.contains(event.relatedTarget)) return;
      closeMenu();
    }} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenu(); focusInput(); }
    }}>
    {label && <label htmlFor={`${menuId}-input`}>{label}</label>}
    <div className="smart-select__anchor" data-placement="below">
    <div className={`smart-select__control ${open ? "is-open" : ""}`} ref={control} onClick={event => {
      if (event.target === event.currentTarget) { refreshIfStale(); setEditor(null); input.current?.focus(); setOpen(true); }
    }}>
      {multiple && <span className="smart-select__chips">{selected.map((option) => <span className="smart-select__chip" key={option.id}><span>{option.name}</span><button type="button" aria-label={`إزالة ${option.name}`} onClick={() => removeChip(option.id)}>×</button></span>)}</span>}
      <input ref={input} type="text" inputMode="text" id={`${menuId}-input`} aria-label={selectionLabel} role="combobox" className={multiple ? "smart-select__input smart-select__input--multi" : "smart-select__input smart-select__input--single"} value={inputValue} placeholder={multiple && selected.length ? "إضافة اختيار..." : `اكتب أو اختر ${label || "..."}`} onClick={() => { refreshIfStale(); setEditor(null); setOpen(true); }} onFocus={() => {
        if (restoringFocus.current) return;
        refreshIfStale(); setEditor(null); setOpen(true); setActiveIndex(-1); if (!multiple) setSearch("");
      }} onChange={(event) => { if (!open) refreshIfStale(); setSearch(event.target.value); setActiveIndex(-1); setOpen(true); }} onKeyDown={onInputKeyDown} aria-autocomplete="list" aria-haspopup="listbox" aria-controls={open ? menuId : undefined} aria-expanded={open} aria-activedescendant={open && activeOption ? activeId : undefined} />
      {!multiple && selected.length > 0 && <button type="button" className="smart-select__clear" aria-label="مسح الاختيار" onClick={() => { setEditor(null); focusInput(); clearSingle(); }}>×</button>}
      <button type="button" className="smart-select__arrow" aria-label={open ? "إغلاق القائمة" : "فتح القائمة"} aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => { setEditor(null); if (open) closeMenu(); else { refreshIfStale(); focusInput(); setOpen(true); } }}>⌄</button>
    </div>
    {open && <div ref={menu} className="smart-select__menu smart-select__menu--anchored" dir="rtl">
      <div ref={results} className="smart-select__results">
      <div ref={content} className="smart-select__results-content">
      {/* Explicit ownership keeps real manager buttons outside the listbox's
          accessibility subtree, while each option retains its adjacent actions. */}
      <div id={menuId} role="listbox" aria-label={selectionLabel} aria-multiselectable={multiple || undefined}
        aria-owns={visible.length ? visible.map(option => `${menuId}-option-${option.id}`).join(" ") : undefined} />
      {visible.length ? visible.map((option, index) => <div className={`smart-select__option ${index === active ? "is-active" : ""}`} key={option.id}>
        <button type="button" role="option" tabIndex={-1} id={`${menuId}-option-${option.id}`} aria-selected={multiple ? (value as string[]).includes(option.id) : value === option.id || (returnLabel && value === option.name)}
          onMouseDown={event => event.preventDefault()} onClick={() => { choose(option.id); focusInput(); }}>
          {multiple && <span aria-hidden="true">{(value as string[]).includes(option.id) ? "☑" : "☐"}</span>}{option.name}
        </button>
        {canManage && <><button type="button" className="smart-select__edit" aria-label={`تعديل ${option.name}`} onClick={(event) => { event.stopPropagation(); setEditor({ id: option.id, name: option.name, key: references.key }); }}>✎</button><button type="button" className="smart-select__archive" aria-label={`أرشفة ${option.name}`} onClick={(event) => { event.stopPropagation(); void archive(option.id); }}>أرشفة</button></>}
      </div>) : <p className="smart-select__empty" role="status">لا توجد نتائج.</p>}
      {showAdd && <button ref={addButton} id={`${menuId}-add`} type="button" className="smart-select__add" data-active={active === visible.length}
        onFocus={() => setActiveIndex(visible.length)} onKeyDown={event => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault(); moveHighlight(event.key === "ArrowUp" ? visible.length - 1 : visible.length);
          } else if (event.key === "Enter") { event.preventDefault(); startAdd(); }
        }} onClick={startAdd}>+ إضافة &quot;{normalizedSearch}&quot;</button>}
      {canManage && editor && editor.key === references.key && <div className="smart-select__editor" role="group" aria-label="تعديل الخيار"><strong>تعديل الخيار</strong><label>اسم العنصر<input autoFocus value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} onKeyDown={event => {
        if (event.key === "Enter") { event.preventDefault(); if (!busy && !event.nativeEvent.isComposing) void saveOption(); }
      }} /></label><div><button type="button" onClick={() => { setEditor(null); focusInput(); }}>إلغاء</button><button type="button" className="primary" disabled={busy || editor.name.trim().length < 2} onClick={() => void saveOption()}>حفظ</button></div></div>}
      </div>
      </div>
    </div>}
    </div>
    {multiple && selected.length > 0 && <button type="button" className="smart-select__clear-all" onClick={() => onChange([])}>مسح الكل</button>}
  </div>;
}
