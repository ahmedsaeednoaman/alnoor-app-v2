import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cacheRuntime, nodes } from "./cache-test-runtime";
import type { SmartSelect } from "../src/components/operations/smart-select";
import { menuPlacement, observeMenuGeometry, revealMenuRow } from "../src/components/operations/smart-select-geometry";

type EventLike = { target: unknown };
class Events {
  listeners = new Map<string, Set<(event: EventLike) => void>>();
  addEventListener(name: string, listener: (event: EventLike) => void) {
    const group = this.listeners.get(name) ?? new Set(); group.add(listener); this.listeners.set(name, group);
  }
  removeEventListener(name: string, listener: (event: EventLike) => void) { this.listeners.get(name)?.delete(listener); }
  emit(name: string, target: unknown = this) { this.listeners.get(name)?.forEach(listener => listener({ target })); }
}
class Box {
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  parentElement: Box | null = null;
  overflowX = "visible"; overflowY = "visible"; contain = "none";
  scrollHeight = 500; scrollTop = 0; clientTop = 0; clientLeft = 0;
  header = false;
  constructor(public left: number, public top: number, public width: number, public height: number) {}
  get offsetWidth() { return this.width; }
  get offsetHeight() { return this.height; }
  get clientWidth() { return this.width; }
  get clientHeight() { return this.height; }
  getBoundingClientRect() { return { left: this.left, right: this.left + this.width, top: this.top, bottom: this.top + this.height, width: this.width, height: this.height }; }
  getClientRects() { return this.width && this.height ? [this.getBoundingClientRect()] : []; }
  contains(other: unknown): boolean { return other === this || other instanceof Box && this.contains(other.parentElement); }
  matches() { return this.header; }
}
function geometryTests() {
  assert.equal(menuPlacement(500, 400, null), "below");
  assert.equal(menuPlacement(300, 90, "below"), "above", "keyboard can flip side");
  assert.equal(menuPlacement(300, 400, "above"), "below", "keyboard closed restores below");
  assert.equal(menuPlacement(120, 110, "below"), "below", "small fluctuations do not flip constrained placement");
  assert.equal(menuPlacement(190, 100, "below"), "above");
  assert.equal(menuPlacement(30, 60, "above"), "below", "a usable row beats placement hysteresis");
  assert.equal(menuPlacement(300, 100, null, 54), "below", "short list fits below");
  const viewport = Object.assign(new Events(), { offsetTop: 0, offsetLeft: 0, width: 360, height: 800 });
  const browser = Object.assign(new Events(), { visualViewport: viewport, innerWidth: 360, innerHeight: 800 });
  const shell = new Box(0, 0, 360, 1200);
  const anchorWrapper = new Box(12, 250, 336, 46); anchorWrapper.parentElement = shell;
  const anchor = new Box(12, 250, 336, 46); anchor.parentElement = anchorWrapper;
  const menu = new Box(12, 296, 336, 240); menu.parentElement = anchorWrapper;
  const content = new Box(12, 296, 336, 500); content.parentElement = menu;
  const navbar = new Box(0, 0, 360, 60); navbar.header = true;
  const bottomNav = new Box(0, 740, 360, 60);
  const doc = Object.assign(new Events(), { body: {}, documentElement: {}, querySelectorAll: () => [navbar, bottomNav] });
  const frames = new Map<number, () => void>(); let nextFrame = 0;
  let resize: (() => void) | undefined; let disconnected = false;
  const globals = {
    window: browser, document: doc, Node: Box,
    getComputedStyle: (element: Box) => element,
    requestAnimationFrame: (callback: () => void) => { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    ResizeObserver: class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() { disconnected = true; } },
  };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); };
  const html = (box: Box) => box as unknown as HTMLElement;
  try {
    const stop = observeMenuGeometry(html(anchor), html(menu), html(content));
    assert.equal(menu.dataset.placement, "below"); assert.equal(menu.style.maxHeight, "240px");
    // Scroll moves the anchor; the code only changes side/available height.
    anchor.top = 220; doc.emit("scroll", shell); doc.emit("scroll", shell); viewport.emit("scroll");
    assert.equal(frames.size, 1, "scroll/viewport events coalesce into one frame"); flush();
    assert.equal(menu.style.visibility, "visible"); assert.equal(menu.dataset.placement, "below");
    assert.equal(menu.style.top, undefined); assert.equal(menu.style.left, undefined); assert.equal(menu.style.position, undefined);
    viewport.height = 360; viewport.emit("resize"); flush();
    assert.equal(menu.dataset.placement, "above"); assert.equal(anchorWrapper.dataset.placement, "above");
    assert.equal(menu.style.maxHeight, "156px", "navbar boundary respected");
    viewport.height = 800; viewport.emit("resize"); flush();
    assert.equal(menu.dataset.placement, "below");
    anchor.top = 640; browser.emit("orientationchange"); flush();
    assert.equal(menu.dataset.placement, "above", "bottom navigation avoided");
    // Intentional drawer/accounting clipping is preserved and measured.
    const drawer = new Box(0, 200, 360, 240); drawer.overflowY = "auto"; drawer.parentElement = shell;
    anchorWrapper.parentElement = drawer; anchor.top = 270;
    stop(); const stopDrawer = observeMenuGeometry(html(anchor), html(menu), html(content));
    assert.equal(menu.style.maxHeight, "120px"); assert.equal(menu.style.visibility, "visible");
    drawer.height = 200; resize?.(); flush(); assert.equal(menu.style.maxHeight, "80px");
    doc.emit("scroll", content); assert.equal(frames.size, 0, "option scrolling causes no geometry work");
    anchor.top = 900; doc.emit("scroll", drawer); flush(); assert.equal(menu.style.visibility, "hidden");
    anchor.top = 270; doc.emit("scroll", drawer); flush(); assert.equal(menu.style.visibility, "visible", "offscreen return preserves open surface");
    stopDrawer(); assert.equal(disconnected, true); viewport.emit("resize"); browser.emit("resize"); doc.emit("scroll", shell); assert.equal(frames.size, 0);
    const surface = new Box(0, 100, 300, 100), row = new Box(0, 230, 300, 44);
    revealMenuRow(html(surface), html(row)); assert.equal(surface.scrollTop, 74);
    surface.scrollTop = 80; row.top = 70; revealMenuRow(html(surface), html(row)); assert.equal(surface.scrollTop, 50);
    row.top = 120; revealMenuRow(html(surface), html(row)); assert.equal(surface.scrollTop, 50, "visible row does not scroll");
  } finally {
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
  console.log("Combobox geometry PASS: inline coordinates, coalesced scroll, viewport flips, clipping/nav boundaries, resize cleanup, options-only reveal (mock DOM)");
}
const isInput = (node: ReturnType<typeof nodes>[number]) => node.props.role === "combobox";
const isAdd = (node: ReturnType<typeof nodes>[number]) => node.props.className === "smart-select__add";
async function componentTests() {
  const r = await cacheRuntime(); await r.activate();
  const Select = r.api.SmartSelect as unknown as typeof SmartSelect;
  let value: string | string[] = "", multiple = false, returnLabel = false;
  const props = { label: "الطبيب", type: "doctors", inlineCreateSource: "doctors" as const,
    optionsEndpoint: "/api/v1/work-forms/references/doctors", canCreate: true, canManage: false };
  const first = r.mount(() => Select({ ...props, value, multiple, maxSelections: 1, returnLabel, onChange(next) { value = next; first.dirty = true; } }));
  const second = r.mount(() => Select({ ...props, value: "", onChange() {} }));
  await r.flush();
  r.requests[0].resolve(Response.json({ items: [{ id: "one", name: "محمد   أحمد" }, { id: "two", name: "محمد سعيد" }] })); await r.flush();
  await r.invoke(first, isInput); await r.invoke(second, isInput);
  const ids = [...nodes(first.value), ...nodes(second.value)].map(node => node.props.id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, "IDs unique across simultaneously mounted instances");
  const wrapper = nodes(first.value).find(node => node.props.className === "smart-select__anchor")!;
  const direct = Array.isArray(wrapper.props.children) ? wrapper.props.children : [wrapper.props.children];
  assert.ok(direct.some(node => node?.props?.className?.includes("smart-select__control")));
  assert.ok(direct.some(node => node?.props?.className?.includes("smart-select__menu--anchored")), "input/control and menu share inline anchor");
  assert.equal(nodes(first.value)[0].props.dir, "rtl");
  const listbox = nodes(first.value).find(node => node.props.role === "listbox")!;
  assert.equal(nodes(first.value).find(isInput)!.props["aria-controls"], listbox.props.id);
  const options = nodes(first.value).filter(node => node.props.role === "option");
  assert.equal(options.length, 2); assert.ok(options.every(node => node.props["aria-selected"] === false));
  assert.equal(listbox.props["aria-owns"], options.map(node => node.props.id).join(" "));
  let prevented = 0;
  const key = async (name: string, target = isInput, composing = false) => {
    await r.invoke(first, target, "onKeyDown", { key: name, nativeEvent: { isComposing: composing }, preventDefault() { prevented++; }, stopPropagation() {} });
  };
  await key("ArrowDown"); assert.equal(nodes(first.value).find(isInput)!.props["aria-activedescendant"], options[0].props.id);
  await key("ArrowDown"); assert.equal(nodes(first.value).find(isInput)!.props["aria-activedescendant"], options[1].props.id);
  await key("ArrowUp"); await key("Enter"); assert.equal(value, "one");
  assert.equal(nodes(first.value).find(isInput)!.props["aria-expanded"], false);
  await r.invoke(first, isInput, "onChange", { target: { value: "محمد أحمد" } }); assert.equal(nodes(first.value).some(isAdd), false);
  await key("Escape"); assert.equal(nodes(first.value).find(isInput)!.props["aria-expanded"], false);
  // A partial match does not silently win over the actual highlighted Add action.
  for (const text of ["م", "مح", "محمد", "محمد "]) await r.invoke(first, isInput, "onChange", { target: { value: text } });
  assert.equal(r.requests.filter(request => request.method === "GET").length, 1, "typing/open/arrows never fetch per keystroke");
  await key("Enter"); assert.equal(value, "one", "no highlight means Enter cannot choose a partial match");
  await key("ArrowDown"); await key("ArrowDown"); await key("ArrowDown");
  assert.equal(nodes(first.value).find(isAdd)!.props["data-active"], true);
  assert.equal(nodes(first.value).find(isAdd)!.props.role, undefined, "Add is a native button, not a database option");
  assert.equal(nodes(first.value).find(isInput)!.props["aria-activedescendant"], undefined);
  await key("ArrowUp", isAdd); assert.equal(nodes(first.value).find(isInput)!.props["aria-activedescendant"], options[1].props.id);
  await key("ArrowDown"); await key("Enter", isAdd);
  assert.equal(r.requests.at(-1)!.method, "POST"); assert.deepEqual(JSON.parse(r.requests.at(-1)!.body!), { name: "محمد" });
  r.requests.at(-1)!.resolve(Response.json({ id: "new", name: "محمد" })); await r.flush(); assert.equal(value, "new");
  r.requests.at(-1)!.resolve(Response.json({ items: [{ id: "one", name: "محمد أحمد" }, { id: "two", name: "محمد سعيد" }] })); await r.flush();
  assert.equal(nodes(first.value).find(isInput)!.props.value, "محمد", "remembered selection survives absence from active list");
  multiple = true; value = []; first.dirty = true; await r.flush(); await r.invoke(first, isInput);
  assert.equal(nodes(first.value).find(node => node.props.role === "listbox")!.props["aria-multiselectable"], true);
  await key("ArrowDown"); await key("Enter"); assert.equal(JSON.stringify(value), JSON.stringify(["one"]));
  assert.equal(nodes(first.value).find(isInput)!.props["aria-expanded"], true);
  await key("ArrowDown"); await key("ArrowDown"); await key("Enter"); assert.equal(JSON.stringify(value), JSON.stringify(["one"]), "maxSelections preserved");
  assert.ok(nodes(first.value).some(node => node.props["aria-label"] === "إزالة محمد أحمد"));
  await r.invoke(first, node => node.props["aria-label"] === "إزالة محمد أحمد"); assert.equal(JSON.stringify(value), "[]");
  multiple = false; returnLabel = true; value = ""; first.dirty = true; await r.flush();
  await key("Escape"); await key("ArrowDown"); await key("Enter"); assert.equal(value, "محمد أحمد");
  await r.invoke(first, node => node.props.className === "smart-select__clear"); assert.equal(value, "");
  await r.invoke(first, isInput, "onChange", { target: { value: "Unknown" } }); await key("ArrowDown");
  const count = r.requests.length; await key("Enter", isInput, true); assert.equal(r.requests.length, count, "IME confirmation cannot create");
  assert.ok(prevented >= 10, "Enter/navigation default behavior suppressed");
  r.dispose();
  console.log("Combobox component PASS: structure/RTL/unique IDs, owned option semantics, arrows/Enter/Add/Escape/IME, single/multi/max/returnLabel/chips/clear, retained labels, no keystroke GET (real SWR, mocked React host)");
}
function cssTests() {
  const css = readFileSync("src/app/globals.css", "utf8");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)].filter(match => match[1].includes("smart-select"));
  assert.equal(rules.some(match => /position\s*:\s*fixed/.test(match[2])), false);
  const connected = css.slice(css.indexOf("/* One connected, field-relative combobox."));
  assert.match(connected, /inset-inline: 0/); assert.match(connected, /inset-block-start: calc\(100% - 1px\)/);
  assert.match(connected, /inset-block-end: calc\(100% - 1px\)/); assert.match(connected, /width: 100%/);
  assert.match(connected, /\.smart-select__results\s*\{[^}]*overflow: auto/);
  assert.match(connected, /min-height: 44px/); assert.match(connected, /\.smart-select__control \{ flex-wrap: wrap/);
  assert.match(connected, /\.smart-select__chip > span \{[^}]*overflow-wrap: anywhere/);
  const component = readFileSync("src/components/operations/smart-select.tsx", "utf8");
  assert.equal(component.includes("scrollDismissed"), false); assert.equal(component.includes("createPortal"), false);
  assert.equal(component.includes("exact ?? visible"), false);
  console.log("Combobox CSS contract PASS: no fixed/portal, connected edges/width, scrollable results, touch targets and narrow-chip wrapping (source assertions, not layout verification)");
}
async function main() { geometryTests(); await componentTests(); cssTests(); }
void main().catch(error => { console.error(error); process.exitCode = 1; });
