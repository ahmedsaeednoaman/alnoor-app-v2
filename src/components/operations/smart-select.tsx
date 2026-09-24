"use client";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useAuthenticatedRequestScope } from "@/components/auth/request-scope-provider";
import { useSharedReference } from "@/lib/shared-references";

export type SmartOption = { id: string; name: string };
type Props = {
  label: string;
  accessibleLabel?: string;
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
const emptyOptions: SmartOption[] = [];
const defaults: Record<string, Record<string, unknown>> = {
  procedures: { category: "عام" }, equipment: { equipmentType: "عام" },
  stents: { stentType: "عام" }, "contract-entities": { entityType: "other" },
  "anesthesia-types": {}, "financial-items": { defaultKind: "financial", defaultAmount: 0 },
};

export function SmartSelect({ label, accessibleLabel, type, value, multiple = false, canManage, maxSelections = null, optionsEndpoint, returnLabel = false, onChange, onOptionChange }: Props) {
  const menuId = useId();
  const control = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const updateMenuBounds = useRef<(() => void) | null>(null);
  const endpoint = optionsEndpoint ?? `/api/v1/catalogs/${type}?active=true&limit=50`;
  const references = useSharedReference(endpoint);
  const options = references.data ?? emptyOptions;
  // Only selected labels are retained locally, never a second full-response cache.
  const [remembered, setRemembered] = useState<{ key: string | null; items: SmartOption[] }>({ key: null, items: [] });
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [scrollDismissed, setScrollDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<{ mode: "add" | "edit"; id?: string; name: string; key: string | null } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const mutationVersion = useRef(0);
  useEffect(() => () => { mutationVersion.current++; }, [endpoint]);
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
        setOpen(false); setSearch(""); setEditor(null); setScrollDismissed(false);
      }
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    const anchor = control.current;
    if (!anchor) return;
    // Inline positioning shares the browser's scroll movement with the field.
    // Measurements only choose a side and a height, never viewport coordinates.
    const boundaries: { element: HTMLElement; x: boolean; y: boolean }[] = [];
    for (let element = anchor.parentElement; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      const paint = /paint|strict|content/.test(style.contain);
      const x = paint || /auto|scroll|hidden|clip/.test(style.overflowX);
      const y = paint || /auto|scroll|hidden|clip/.test(style.overflowY);
      if (x || y) boundaries.push({ element, x, y });
    }
    const chrome = [document.querySelector<HTMLElement>(".app-navbar"), document.querySelector<HTMLElement>(".mobile-bottom-navigation")];
    let frame = 0;
    let placement: "above" | "below" | null = null;
    const update = () => {
      const dropdown = menu.current;
      if (!dropdown) return;
      const rect = anchor.getBoundingClientRect();
      if (!rect.width || !rect.height) { dropdown.style.visibility = "hidden"; return; }
      const scaleY = anchor.offsetHeight ? rect.height / anchor.offsetHeight : 1;
      let top = viewport?.offsetTop ?? 0;
      let left = viewport?.offsetLeft ?? 0;
      let right = left + (viewport?.width ?? window.innerWidth);
      let bottom = top + (viewport?.height ?? window.innerHeight);
      for (const { element, x, y } of boundaries) {
        // The document scrollport is already represented by visualViewport.
        if (element === document.body || element === document.documentElement) continue;
        const bounds = element.getBoundingClientRect();
        const sx = element.offsetWidth ? bounds.width / element.offsetWidth : 1;
        const sy = element.offsetHeight ? bounds.height / element.offsetHeight : 1;
        if (x) { left = Math.max(left, bounds.left + element.clientLeft * sx); right = Math.min(right, bounds.left + (element.clientLeft + element.clientWidth) * sx); }
        if (y) { top = Math.max(top, bounds.top + element.clientTop * sy); bottom = Math.min(bottom, bounds.top + (element.clientTop + element.clientHeight) * sy); }
      }
      chrome.forEach((element, index) => {
        if (!element || !element.getClientRects().length) return;
        const bounds = element.getBoundingClientRect();
        if (bounds.right <= rect.left || bounds.left >= rect.right) return;
        if (index === 0) top = Math.max(top, bounds.bottom);
        else bottom = Math.min(bottom, bounds.top);
      });
      const gap = 6 * scaleY;
      const below = Math.max(0, bottom - 8 - rect.bottom - gap);
      const above = Math.max(0, rect.top - gap - top - 8);
      const visible = rect.bottom > top && rect.top < bottom && rect.right > left && rect.left < right;
      const space = { above: above / scaleY, below: below / scaleY };
      if (placement === null) {
        // Content height informs the initial decision only, never filtering updates.
        const desired = Math.min(240, dropdown.scrollHeight + 2);
        placement = space.below >= desired || space.below >= space.above ? "below" : "above";
      }
      const available = Math.min(240, space[placement]);
      dropdown.dataset.placement = placement;
      dropdown.style.maxHeight = `${available}px`;
      // Preserve the existing offscreen hiding policy while geometry is moving.
      dropdown.style.visibility = !visible || available < 24 ? "hidden" : "visible";
    };
    // Track the actual scrollports, including drawers and the document scroller.
    // A scroll event alone cannot tell user scrolling from keyboard auto-panning.
    const scrollers = new Map<Element, { top: number; left: number }>();
    for (let element = anchor.parentElement; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (/auto|scroll|overlay/.test(`${style.overflowX} ${style.overflowY}`)) {
        scrollers.set(element, { top: element.scrollTop, left: element.scrollLeft });
      }
    }
    const page = document.scrollingElement;
    if (page) scrollers.set(page, { top: page.scrollTop, left: page.scrollLeft });
    let gesture: { x: number; y: number; target: Node } | null = null;
    const intendedScrollers = new Set<Element>();
    const insideMenu = (target: EventTarget | null) => target instanceof Node && !!menu.current?.contains(target);
    const arm = (target: EventTarget | null) => {
      if (!(target instanceof Node) || insideMenu(target)) return;
      intendedScrollers.clear();
      for (const element of scrollers.keys()) if (element.contains(target)) intendedScrollers.add(element);
    };
    const startTouch = (event: TouchEvent) => {
      intendedScrollers.clear();
      const touch = event.touches.length === 1 ? event.touches[0] : undefined;
      gesture = touch && event.target instanceof Node && !insideMenu(event.target)
        ? { x: touch.clientX, y: touch.clientY, target: event.target } : null;
    };
    const moveTouch = (event: TouchEvent) => {
      const touch = event.touches.length === 1 ? event.touches[0] : undefined;
      // Gesture slop distinguishes dragging from tapping/focus, not placement.
      if (gesture && touch && Math.hypot(touch.clientX - gesture.x, touch.clientY - gesture.y) >= 8) arm(gesture.target);
    };
    const endTouch = () => { gesture = null; intendedScrollers.clear(); };
    const startPointer = (event: PointerEvent) => {
      intendedScrollers.clear();
      if (event.pointerType !== "touch") gesture = event.target instanceof Node && !insideMenu(event.target)
        ? { x: event.clientX, y: event.clientY, target: event.target } : null;
    };
    const movePointer = (event: PointerEvent) => {
      if (event.pointerType !== "touch" && event.buttons && gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) >= 8) arm(gesture.target);
    };
    const endPointer = (event: PointerEvent) => { if (event.pointerType !== "touch") endTouch(); };
    const onWheel = (event: WheelEvent) => {
      intendedScrollers.clear();
      if (event.deltaX || event.deltaY) arm(event.target);
    };
    const onKey = (event: KeyboardEvent) => {
      intendedScrollers.clear();
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]")) return;
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) arm(event.target);
    };
    const onScroll = (event: Event) => {
      if (insideMenu(event.target)) return;
      const element = event.target === document ? page : event.target;
      if (!(element instanceof Element)) return;
      const previous = scrollers.get(element);
      if (!previous) return;
      const moved = previous.top !== element.scrollTop || previous.left !== element.scrollLeft;
      scrollers.set(element, { top: element.scrollTop, left: element.scrollLeft });
      if (moved && intendedScrollers.has(element)) {
        // Hide in this event; React removes it without touching focus or values.
        if (menu.current) menu.current.style.visibility = "hidden";
        setScrollDismissed(true); setOpen(false); setEditor(null);
      } else update();
    };
    const onViewportChange = () => {
      // Keyboard resizing/auto-panning is never evidence of user scroll intent.
      if (!gesture) intendedScrollers.clear();
      update();
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    updateMenuBounds.current = update;
    update();
    window.addEventListener("resize", onViewportChange);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("pointerdown", startPointer, { passive: true, capture: true });
    document.addEventListener("pointermove", movePointer, { passive: true, capture: true });
    document.addEventListener("pointerup", endPointer, true);
    document.addEventListener("pointercancel", endPointer, true);
    document.addEventListener("touchstart", startTouch, { passive: true, capture: true });
    document.addEventListener("touchmove", moveTouch, { passive: true, capture: true });
    document.addEventListener("touchend", endTouch, true);
    document.addEventListener("touchcancel", endTouch, true);
    document.addEventListener("wheel", onWheel, { passive: true, capture: true });
    document.addEventListener("keydown", onKey, true);
    viewport?.addEventListener("resize", onViewportChange);
    viewport?.addEventListener("scroll", onViewportChange);
    const observer = new ResizeObserver(schedule);
    observer.observe(anchor);
    if (menu.current) observer.observe(menu.current);
    boundaries.forEach(({ element }) => observer.observe(element));
    chrome.forEach(element => { if (element) observer.observe(element); });
    return () => {
      updateMenuBounds.current = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", onViewportChange);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("pointerdown", startPointer, true);
      document.removeEventListener("pointermove", movePointer, true);
      document.removeEventListener("pointerup", endPointer, true);
      document.removeEventListener("pointercancel", endPointer, true);
      document.removeEventListener("touchstart", startTouch, true);
      document.removeEventListener("touchmove", moveTouch, true);
      document.removeEventListener("touchend", endTouch, true);
      document.removeEventListener("touchcancel", endTouch, true);
      document.removeEventListener("wheel", onWheel, true);
      document.removeEventListener("keydown", onKey, true);
      viewport?.removeEventListener("resize", onViewportChange);
      viewport?.removeEventListener("scroll", onViewportChange);
    };
  }, [open]);
  // Filtering, chips and the existing inline editor can change the menu's size.
  useLayoutEffect(() => { updateMenuBounds.current?.(); });

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
    const ticket = capture(); if (!ticket) return;
    const mutation = mutationVersion.current;
    setBusy(true);
    const response = await fetch(`/api/v1/catalogs/${type}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, ...(defaults[type] ?? {}) }) });
    if (!isCurrent(ticket) || mutation !== mutationVersion.current) { setBusy(false); return; }
    if ([401, 403].includes(response.status)) { setBusy(false); deny(); return; }
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!isCurrent(ticket) || mutation !== mutationVersion.current) return;
    if (!response.ok || !body.item?.id) { alert(body.error?.message ?? "تعذر إضافة العنصر"); return; }
    rememberOption(body.item);
    void references.invalidateCatalog(type, ticket);
    onChange(multiple ? [...(value as string[]), body.item.id] : returnLabel ? body.item.name : body.item.id);
    setSearch(""); setOpen(!multiple);
  }
  function startAdd() { void createOption(normalizedSearch); }
  async function saveOption() {
    if (!editor || editor.key !== references.key) return;
    const name = editor.name.trim().replace(/\s+/gu, " ");
    if (name.length < 2) return;
    const ticket = capture(); if (!ticket) return;
    const mutation = mutationVersion.current;
    setBusy(true);
    const response = await fetch(editor.mode === "edit" ? `/api/v1/catalogs/${type}/${editor.id}` : `/api/v1/catalogs/${type}`, {
      method: editor.mode === "edit" ? "PATCH" : "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(editor.mode === "edit" ? { name } : { name, ...(defaults[type] ?? {}) }),
    });
    if (!isCurrent(ticket) || mutation !== mutationVersion.current) { setBusy(false); return; }
    if ([401, 403].includes(response.status)) { setBusy(false); deny(); return; }
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!isCurrent(ticket) || mutation !== mutationVersion.current) return;
    if (!response.ok || !body.item?.id) { alert(body.error?.message ?? "تعذر حفظ العنصر"); return; }
    rememberOption(body.item);
    void references.invalidateCatalog(type, ticket);
    if (editor.mode === "add") onChange(multiple ? [...(value as string[]), body.item.id] : body.item.id);
    setEditor(null); setSearch(""); setOpen(!multiple);
  }
  async function archive(id: string) {
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
  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") { setScrollDismissed(false); setOpen(false); setSearch(""); setEditor(null); return; }
    if (event.key === "ArrowDown") { if (!open) refreshIfStale(); event.preventDefault(); setScrollDismissed(false); setOpen(true); setActiveIndex((current) => Math.min(current + 1, Math.max(visible.length - 1, 0))); return; }
    if (event.key === "ArrowUp") { if (!open) refreshIfStale(); event.preventDefault(); setScrollDismissed(false); setOpen(true); setActiveIndex((current) => Math.max(current - 1, 0)); return; }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const keyboardChoice = exact ?? visible[activeIndex];
    if (keyboardChoice) choose(keyboardChoice.id); else if (canManage && normalizedSearch.length >= 2) startAdd();
  }
  const inputValue = multiple || open || scrollDismissed ? search : selected[0]?.name ?? "";
  return <div className="smart-select" ref={root} data-open={open}>
    {label && <label htmlFor={`${menuId}-input`}>{label}</label>}
    <div className="smart-select__anchor">
    <div className={`smart-select__control ${open ? "is-open" : ""}`} ref={control} onClick={event => {
      if (event.target === event.currentTarget) { refreshIfStale(); setEditor(null); input.current?.focus(); setScrollDismissed(false); setOpen(true); }
    }}>
      {multiple && <span className="smart-select__chips">{selected.map((option) => <span className="smart-select__chip" key={option.id}>{option.name}<button type="button" aria-label={`إزالة ${option.name}`} onClick={() => removeChip(option.id)}>×</button></span>)}</span>}
      <input ref={input} type="text" inputMode="text" id={`${menuId}-input`} aria-label={accessibleLabel || label || "اختيار عنصر"} role="combobox" className={multiple ? "smart-select__input smart-select__input--multi" : "smart-select__input smart-select__input--single"} value={inputValue} placeholder={multiple && selected.length ? "إضافة اختيار..." : `اكتب أو اختر ${label || "..."}`} onClick={() => { refreshIfStale(); setEditor(null); setScrollDismissed(false); setOpen(true); }} onFocus={() => { refreshIfStale(); setEditor(null); setOpen(true); setActiveIndex(0); if (!multiple && !scrollDismissed) setSearch(""); setScrollDismissed(false); }} onChange={(event) => { if (!open) refreshIfStale(); setScrollDismissed(false); setSearch(event.target.value); setActiveIndex(0); setOpen(true); }} onKeyDown={onInputKeyDown} aria-autocomplete="list" aria-controls={menuId} aria-expanded={open} aria-activedescendant={open && visible[activeIndex] ? `${menuId}-option-${visible[activeIndex].id}` : undefined} />
      {!multiple && selected.length > 0 && <button type="button" className="smart-select__clear" aria-label="مسح الاختيار" onClick={() => { setEditor(null); input.current?.focus(); setScrollDismissed(false); clearSingle(); }}>×</button>}
      <button type="button" className="smart-select__arrow" aria-label="فتح القائمة" onClick={() => { setEditor(null); if (open) setOpen(false); else { refreshIfStale(); input.current?.focus(); setScrollDismissed(false); setOpen(true); } }}>⌄</button>
    </div>
    {open && <div ref={menu} className="smart-select__menu smart-select__menu--anchored" dir="rtl" id={menuId} role="listbox">
      {visible.length ? visible.map((option, index) => <div className={`smart-select__option ${index === activeIndex ? "is-active" : ""}`} id={`${menuId}-option-${option.id}`} key={option.id}>
        <button type="button" onClick={() => choose(option.id)}>{multiple && <span>{(value as string[]).includes(option.id) ? "☑" : "☐"}</span>}{option.name}</button>
        {canManage && <><button type="button" className="smart-select__edit" aria-label={`تعديل ${option.name}`} onClick={(event) => { event.stopPropagation(); setEditor({ mode: "edit", id: option.id, name: option.name, key: references.key }); }}>✎</button><button type="button" className="smart-select__archive" aria-label={`أرشفة ${option.name}`} onClick={(event) => { event.stopPropagation(); void archive(option.id); }}>أرشفة</button></>}
      </div>) : <p>لا توجد نتائج.</p>}
      {canManage && normalizedSearch.length >= 2 && !exact && <button disabled={busy} type="button" className="smart-select__add" onClick={startAdd}>+ إضافة &quot;{normalizedSearch}&quot;</button>}
      {editor && editor.key === references.key && <div className="smart-select__editor" role="dialog" aria-label={editor.mode === "edit" ? "تعديل الخيار" : "إضافة خيار جديد"}><strong>{editor.mode === "edit" ? "تعديل الخيار" : "إضافة خيار جديد"}</strong><label>اسم العنصر<input autoFocus value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></label><div><button type="button" onClick={() => setEditor(null)}>إلغاء</button><button type="button" className="primary" disabled={busy || editor.name.trim().length < 2} onClick={() => void saveOption()}>{editor.mode === "edit" ? "حفظ" : "إضافة"}</button></div></div>}
    </div>}
    </div>
    {multiple && selected.length > 0 && <button type="button" className="smart-select__clear-all" onClick={() => onChange([])}>مسح الكل</button>}
  </div>;
}
