"use client";

import { useLayoutEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useDialogScrollLock } from "@/components/settings/users/use-dialog-scroll-lock";

const mobileQuery = "(max-width: 767px)";
function subscribeMobile(notify: () => void) {
  const media = window.matchMedia(mobileQuery);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}
export function useMobileSelection() {
  return useSyncExternalStore(subscribeMobile, () => window.matchMedia(mobileQuery).matches, () => false);
}

/** Presentation only: native modal focus containment on phones, measured anchor on desktop. */
export function SelectionSurface({ mobile, anchor, title, titleId, onClose, children }: {
  mobile: boolean;
  anchor: RefObject<HTMLDivElement | null>;
  title: string;
  titleId: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useLayoutEffect(() => { close.current = onClose; });
  useDialogScrollLock(mobile, false);

  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      if (mobile) {
        const element = dialog.current;
        if (!element) return;
        element.style.top = `${viewport?.offsetTop ?? 0}px`;
        element.style.left = `${viewport?.offsetLeft ?? 0}px`;
        element.style.width = `${viewport?.width ?? window.innerWidth}px`;
        element.style.height = `${viewport?.height ?? window.innerHeight}px`;
        element.toggleAttribute("data-compact", (viewport?.height ?? window.innerHeight) < 420);
      } else {
        const element = popover.current;
        const control = anchor.current;
        if (!element || !control) return;
        const rect = control.getBoundingClientRect();
        const height = viewport?.height ?? window.innerHeight;
        const top = viewport?.offsetTop ?? 0;
        const left = viewport?.offsetLeft ?? 0;
        const width = viewport?.width ?? window.innerWidth;
        if (rect.bottom <= top || rect.top >= top + height) { close.current(); return; }
        const below = top + height - rect.bottom - 14;
        const above = rect.top - top - 14;
        const placeAbove = below < 240 && above > below;
        const available = Math.max(0, placeAbove ? above : below);
        element.style.width = `${Math.min(rect.width, width - 24)}px`;
        element.style.left = `${Math.max(left + 12, Math.min(rect.left, left + width - element.offsetWidth - 12))}px`;
        element.style.maxHeight = `${Math.min(400, available)}px`;
        element.style.top = `${placeAbove ? rect.top - element.offsetHeight - 6 : rect.bottom + 6}px`;
      }
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    const modal = dialog.current;
    const trigger = anchor.current?.querySelector<HTMLElement>("[data-select-trigger]");
    if (mobile) modal?.showModal();
    update();
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    const observer = new ResizeObserver(schedule);
    if (anchor.current) observer.observe(anchor.current);
    if (popover.current) observer.observe(popover.current);
    const outside = (event: PointerEvent) => {
      if (!mobile && event.target instanceof Node && !anchor.current?.contains(event.target) && !popover.current?.contains(event.target)) close.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (!mobile && event.key === "Escape") { event.preventDefault(); close.current(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, true);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      if (mobile) { modal?.close(); trigger?.focus({ preventScroll: true }); }
    };
  }, [mobile, anchor]);

  return createPortal(mobile ? (
    <dialog ref={dialog} className="selection-sheet" dir="rtl" aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="selection-sheet__panel">
        <header><h2 id={titleId}>{title}</h2><button type="button" onClick={onClose} aria-label={`إغلاق ${title}`}>إغلاق ×</button></header>
        {children}
      </div>
    </dialog>
  ) : <div ref={popover} className="selection-popover" dir="rtl">{children}</div>, document.body);
}
