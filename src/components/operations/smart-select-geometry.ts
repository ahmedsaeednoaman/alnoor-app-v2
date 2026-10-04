export type MenuPlacement = "above" | "below";
export const MENU_MAX_HEIGHT = 240;
export const MENU_ROW_HEIGHT = 44;

// Geometry/content changes can flip placement without height feedback loops.
// A whole extra touch row is a meaningful gain when both sides are constrained.
export function menuPlacement(above: number, below: number, previous: MenuPlacement | null, desired = MENU_MAX_HEIGHT): MenuPlacement {
  const target = Math.min(MENU_MAX_HEIGHT, Math.max(MENU_ROW_HEIGHT + 10, desired));
  if (below >= target) return "below";
  if (above >= target) return "above";
  const minimum = MENU_ROW_HEIGHT + 10;
  if (above < minimum || below < minimum) return above > below ? "above" : "below";
  if (previous === "above" && above >= below - MENU_ROW_HEIGHT) return "above";
  if (previous === "below" && below >= above - MENU_ROW_HEIGHT) return "below";
  return above > below ? "above" : "below";
}

// Scroll only the options surface. Element.scrollIntoView can also pan the
// document/drawer and fight Android's keyboard auto-panning.
export function revealMenuRow(surface: HTMLElement, row: HTMLElement) {
  const bounds = surface.getBoundingClientRect();
  const item = row.getBoundingClientRect();
  const scale = surface.offsetHeight ? bounds.height / surface.offsetHeight : 1;
  const top = bounds.top + surface.clientTop * scale;
  const bottom = top + surface.clientHeight * scale;
  const delta = item.top < top ? item.top - top : item.bottom > bottom ? item.bottom - bottom : 0;
  if (delta) surface.scrollTop += delta / scale;
}

export function observeMenuGeometry(anchor: HTMLElement, menu: HTMLElement, content: HTMLElement) {
  const viewport = window.visualViewport;
  const boundaries: { element: HTMLElement; x: boolean; y: boolean }[] = [];
  for (let element = anchor.parentElement; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    const paint = /paint|strict|content/.test(style.contain);
    const x = paint || /auto|scroll|hidden|clip/.test(style.overflowX);
    const y = paint || /auto|scroll|hidden|clip/.test(style.overflowY);
    if (x || y) boundaries.push({ element, x, y });
  }
  // Preserve the layout's scrollports; also avoid its fixed/sticky chrome.
  const chrome = [...document.querySelectorAll<HTMLElement>(
    ".app-navbar, .mobile-bottom-navigation, .operation-drawer-v2__header, .operation-drawer-v2__footer, .doctor-supply-dialog__panel > header, .doctor-supply-dialog__panel > footer, .pricing-profile-editor > header, .pricing-profile-editor > footer, .unified-financial-review > footer",
  )].filter(element => !element.contains(anchor));
  let frame = 0;
  let placement: MenuPlacement | null = null;
  let disposed = false;
  const update = () => {
    frame = 0;
    if (disposed) return;
    // All geometry reads precede writes. CSS alone controls menu position/width.
    const rect = anchor.getBoundingClientRect();
    const scaleY = anchor.offsetHeight ? rect.height / anchor.offsetHeight : 1;
    let top = viewport?.offsetTop ?? 0;
    let left = viewport?.offsetLeft ?? 0;
    let right = left + (viewport?.width ?? window.innerWidth);
    let bottom = top + (viewport?.height ?? window.innerHeight);
    for (const { element, x, y } of boundaries) {
      if (element === document.body || element === document.documentElement) continue;
      const bounds = element.getBoundingClientRect();
      const sx = element.offsetWidth ? bounds.width / element.offsetWidth : 1;
      const sy = element.offsetHeight ? bounds.height / element.offsetHeight : 1;
      if (x) { left = Math.max(left, bounds.left + element.clientLeft * sx); right = Math.min(right, bounds.left + (element.clientLeft + element.clientWidth) * sx); }
      if (y) { top = Math.max(top, bounds.top + element.clientTop * sy); bottom = Math.min(bottom, bounds.top + (element.clientTop + element.clientHeight) * sy); }
    }
    for (const element of chrome) {
      if (!element.getClientRects().length) continue;
      const bounds = element.getBoundingClientRect();
      if (bounds.right <= rect.left || bounds.left >= rect.right || bounds.bottom <= top || bounds.top >= bottom) continue;
      // Chrome outside this field's panel is relevant only if it actually
      // occupies the same screen strip. Never move an inline menu around it.
      if (element.matches(".app-navbar, .operation-drawer-v2__header, .doctor-supply-dialog__panel > header, .pricing-profile-editor > header")) top = Math.max(top, bounds.bottom);
      else bottom = Math.min(bottom, bounds.top);
    }
    const visible = rect.width > 0 && rect.height > 0 && rect.bottom > top && rect.top < bottom && rect.right > left && rect.left < right;
    const above = Math.max(0, (rect.top - top - 4) / (scaleY || 1));
    const below = Math.max(0, (bottom - rect.bottom - 4) / (scaleY || 1));
    placement = menuPlacement(above, below, placement, content.scrollHeight + 2);
    const height = Math.min(MENU_MAX_HEIGHT, placement === "above" ? above : below);
    menu.dataset.placement = placement;
    anchor.parentElement!.dataset.placement = placement;
    menu.style.maxHeight = `${height}px`;
    // An offscreen anchor may temporarily hide its menu, but scrolling never
    // closes it or clears typed text. Returning the field restores the surface.
    menu.style.visibility = visible ? "visible" : "hidden";
  };
  const schedule = () => { if (!frame && !disposed) frame = requestAnimationFrame(update); };
  const onScroll = (event: Event) => {
    if (event.target instanceof Node && menu.contains(event.target)) return;
    schedule();
  };
  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", schedule);
  document.addEventListener("scroll", onScroll, true);
  viewport?.addEventListener("resize", schedule);
  viewport?.addEventListener("scroll", schedule);
  const observer = new ResizeObserver(schedule);
  observer.observe(anchor);
  observer.observe(content);
  // Include non-clipping layout ancestors: preceding fields/chips can move us.
  for (let element = anchor.parentElement; element; element = element.parentElement) observer.observe(element);
  chrome.forEach(element => observer.observe(element));
  update();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener("resize", schedule);
    window.removeEventListener("orientationchange", schedule);
    document.removeEventListener("scroll", onScroll, true);
    viewport?.removeEventListener("resize", schedule);
    viewport?.removeEventListener("scroll", schedule);
  };
}
