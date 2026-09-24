import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as query from "../src/lib/operations/list-query";
import * as monthly from "../src/lib/pagination/monthly";

type Element = { type: unknown; props: Record<string, unknown> };
type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
const source = ts.transpileModule(readFileSync("src/components/operations/operations-list.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node) || !("type" in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function harness(wide = false, selected = "", delayed = false) {
  const slots: Slot[] = [];
  let cursor = 0, dirty = true;
  let tree: Element;
  let pending: Array<() => void> = [];
  const listeners = new Set<() => void>();
  const historyListeners = new Set<() => void>();
  let now = 0, timerId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock = {
    setTimeout: (callback: () => void, delay: number) => { const id = ++timerId; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
    addEventListener: (_: string, callback: () => void) => historyListeners.add(callback),
    removeEventListener: (_: string, callback: () => void) => historyListeners.delete(callback),
  };
  const responses: Array<(body: unknown) => void> = [];
  const signals: AbortSignal[] = [];
  const emptyBody = { operations: [], pagination: { total: 0, totalPages: 0 }, filters: {} };
  const media = { matches: wide, addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) };
  const location = { search: `?period=month&year=2026&month=9&page=1&pageSize=25${selected}`, hash: "", pathname: "/operations" };
  const requests: string[] = [];
  const mounted = new Set<string>();
  const mounts: string[] = [];
  const writes: string[] = [];
  const exports: { OperationsList?: (props: unknown) => Element } = {};
  function memo(factory: () => unknown, deps: unknown[]) {
    const slot = slots[cursor++] ??= {};
    if (!slot.deps || deps.some((value, index) => !Object.is(value, slot.deps?.[index]))) { slot.value = factory(); slot.deps = deps; }
    return slot.value;
  }
  const history = { replaceState: (_: unknown, __: string, url: string) => { writes.push(url); location.search = url.split("#")[0]; dirty = true; } };
  vm.runInNewContext(source, {
    exports, URLSearchParams, AbortController, window: { ...clock, matchMedia: () => media, location, history }, history, location,
    fetch: async (url: string, init: {signal: AbortSignal}) => {
      requests.push(url); signals.push(init.signal);
      const body = delayed ? await new Promise<unknown>(resolve => responses.push(resolve)) : emptyBody;
      return { ok: true, json: async () => body };
    },
    require: (name: string) => {
      if (name === "react/jsx-runtime") return { jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }), jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props }), Fragment: "fragment" };
      if (name === "react") return {
        useState: (initial: unknown) => {
          const index = cursor++;
          if (!slots[index]) {
            const slot: Slot = { value: initial };
            slots[index] = slot;
            Object.assign(slot, { setter: (next: unknown) => { const value = typeof next === "function" ? next(slot.value) : next; if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; } } });
          }
          const slot = slots[index] as Slot & { setter: (next: unknown) => void };
          return [slot.value, slot.setter];
        },
        useRef: (value: unknown) => memo(() => ({ current: value }), []),
        useMemo: memo,
        useCallback: (callback: unknown, deps: unknown[]) => memo(() => callback, deps),
        useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
          const slot = slots[cursor++] ??= {};
          if (!slot.deps || deps.some((value, index) => !Object.is(value, slot.deps?.[index]))) {
            slot.deps = deps; pending.push(() => { slot.cleanup?.(); slot.cleanup = effect() || undefined; });
          }
        },
      };
      if (name === "next/navigation") return { useSearchParams: () => new URLSearchParams(location.search) };
      if (name === "@/lib/operations/list-query") return query;
      if (name === "@/lib/pagination/monthly") return monthly;
      if (name === "./smart-select") return { SmartSelect: "SmartSelect" };
      if (name.includes("compact-month-filter")) return { CompactMonthFilter: "Month" };
      if (name.includes("bottom-pagination")) return { BottomPagination: "Pagination" };
      return {};
    },
  });
  function render() {
    assert.ok(exports.OperationsList); cursor = 0; dirty = false;
    tree = exports.OperationsList({ canEditAll: false, isEmployee: true, defaultMonth: { year: 2026, month: 9 } });
    const controls = elements(tree).filter(node => node.type === "SmartSelect");
    const current = new Set(controls.map(node => String(node.props.type)));
    for (const type of current) if (!mounted.has(type)) mounts.push(type);
    mounted.clear(); for (const type of current) mounted.add(type);
    const effects = pending; pending = []; effects.forEach(run => run());
  }
  return {
    requests, mounts, writes, location, signals,
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    },
    navigate(search: string) { location.search = search; dirty = true; historyListeners.forEach(fn => fn()); },
    respond(index: number, caseName: string) {
      responses[index]({ ...emptyBody, operations: [{ id: caseName, operationDate: "2026-09-24", operationTime: "10:00", dailySequence: 1, caseName, type: "endoscopy" }] });
    },
    type(value: string) {
      const input = elements(tree).find(node => node.type === "input" && node.props.placeholder === "اسم الحالة أو الرقم الموحد")!;
      (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
    },
    input() { return elements(tree).find(node => node.type === "input" && node.props.placeholder === "اسم الحالة أو الرقم الموحد")!.props.value; },
    async flush() { for (let i = 0; i < 12; i++) { if (dirty) render(); await Promise.resolve(); } },
    nodes: () => elements(tree),
    toggle() {
      const buttons = elements(tree).filter(node => node.props["aria-controls"] === "operations-filter-panel");
      const button = buttons.find(node => node.props.className === (media.matches ? "operations-toggle-desktop" : "operations-toggle-mobile")) ?? buttons[0];
      assert.equal(typeof button.props.onClick, "function");
      (button.props.onClick as () => void)();
    },
    resize(matches: boolean) { media.matches = matches; listeners.forEach(fn => fn()); },
    dispose() { slots.forEach(slot => slot.cleanup?.()); assert.equal(listeners.size, 0); assert.equal(timers.size, 0); assert.equal(historyListeners.size, 0); },
  };
}
async function filterRegression() {
  const h = harness(); await h.flush(); assert.deepEqual(h.mounts, []); assert.equal(h.requests.length, 1);
  h.toggle(); await h.flush(); assert.deepEqual(h.mounts, ["doctors", "hospitals"]);
  h.toggle(); await h.flush(); h.toggle(); await h.flush();
  assert.deepEqual(h.mounts, ["doctors", "hospitals"]); assert.equal(h.requests.length, 1); assert.deepEqual(h.writes, []);
  const search = h.nodes().find(node => node.type === "input" && node.props.placeholder === "اسم الحالة أو الرقم الموحد");
  (search?.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "أحمد" } }); await h.flush();
  h.advance(300); await h.flush(); assert.ok(h.requests.at(-1)?.includes("search="));
  (h.nodes().find(node => node.type === "Month")?.props.onMonthChange as (month: monthly.CalendarMonth) => void)({ year: 2026, month: 8 }); await h.flush();
  assert.equal(new URLSearchParams(h.location.search).get("month"), "8");
  (h.nodes().find(node => node.type === "Pagination")?.props.onPageChange as (page: number) => void)(2); await h.flush();
  assert.equal(new URLSearchParams(h.location.search).get("page"), "2"); h.dispose();
  for (const [key, type] of [["doctorId", "doctors"], ["hospitalId", "hospitals"]]) {
    const selected = harness(false, `&${key}=selected-id`); await selected.flush();
    assert.ok(selected.requests[0].includes(`${key}=selected-id`));
    const control = () => selected.nodes().find(node => node.type === "SmartSelect" && node.props.type === type)!;
    assert.equal(control().props.value, "selected-id"); assert.deepEqual(selected.writes, []);
    selected.toggle(); await selected.flush(); selected.toggle(); await selected.flush(); selected.toggle(); await selected.flush();
    assert.equal(control().props.value, "selected-id"); assert.equal(selected.mounts.length, 2);
    (control().props.onChange as (value: string) => void)(""); await selected.flush();
    assert.equal(new URLSearchParams(selected.location.search).has(key), false); assert.equal(control().props.value, "");
    assert.equal(selected.mounts.length, 2); assert.equal(selected.requests.length, 2); selected.dispose();
  }
  const desktop = harness(true); await desktop.flush(); assert.equal(desktop.mounts.length, 2); desktop.toggle(); await desktop.flush(); assert.equal(desktop.mounts.length, 2); desktop.dispose();
  const responsive = harness(); await responsive.flush(); responsive.resize(true); await responsive.flush(); assert.equal(responsive.mounts.length, 2); responsive.dispose();

}
async function main() {
  await filterRegression();
  const canonical = "?period=month&year=2026&month=9&page=4&pageSize=50&doctorId=doc&hospitalId=hospital&search=old";
  const h = harness(false, "&search=old"); await h.flush();
  h.navigate(canonical); await h.flush(); assert.equal(h.input(), "old");
  const baseline = h.requests.length;
  for (const phrase of ["أ", "أح", "أحمد", "أحمد علي"]) {
    h.type(phrase); await h.flush(); assert.equal(h.input(), phrase); h.advance(70);
  }
  assert.equal(h.requests.length, baseline);
  h.advance(229); await h.flush(); assert.equal(h.requests.length, baseline);
  h.advance(1); await h.flush(); assert.equal(h.requests.length, baseline + 1);
  let params = new URLSearchParams(h.location.search);
  assert.equal(params.get("search"), "أحمد علي"); assert.equal(params.get("page"), "1");
  assert.equal(params.get("doctorId"), "doc"); assert.equal(params.get("hospitalId"), "hospital"); assert.equal(params.get("pageSize"), "50");
  h.type("pause"); await h.flush(); h.advance(300); await h.flush(); assert.equal(new URLSearchParams(h.location.search).get("search"), "pause");
  h.type(""); await h.flush(); assert.equal(h.input(), ""); h.advance(300); await h.flush(); assert.equal(new URLSearchParams(h.location.search).has("search"), false);

  h.type("discard month"); await h.flush();
  (h.nodes().find(node => node.type === "Month")!.props.onMonthChange as (month: monthly.CalendarMonth) => void)({ year: 2026, month: 8 }); await h.flush();
  const afterMonth = h.requests.length; h.advance(300); await h.flush(); assert.equal(h.requests.length, afterMonth); assert.equal(h.input(), "");
  h.type("discard type"); await h.flush();
  const tab = h.nodes().find(node => node.props.role === "tab" && node.props.children === "المناظير")!;
  (tab.props.onClick as () => void)(); await h.flush(); h.advance(300); await h.flush();
  params = new URLSearchParams(h.location.search); assert.equal(params.get("type"), "endoscopy"); assert.equal(params.has("search"), false);

  h.type("obsolete"); await h.flush(); h.navigate(canonical); await h.flush(); assert.equal(h.input(), "old");
  h.advance(300); await h.flush(); assert.equal(h.location.search, canonical);
  const forward = canonical.replace("search=old", "search=forward");
  h.navigate(forward); await h.flush(); assert.equal(h.input(), "forward");
  h.type("unmounted"); await h.flush(); h.dispose(); const writes = h.writes.length; h.advance(300); assert.equal(h.writes.length, writes);

  const race = harness(false, "", true); await race.flush();
  race.type("first"); await race.flush(); race.advance(300); await race.flush();
  race.type("second"); await race.flush(); race.advance(300); await race.flush();
  assert.equal(race.requests.length, 3); assert.equal(race.signals[1].aborted, true);
  race.respond(2, "new result"); await race.flush();
  race.respond(1, "old result"); race.respond(0, "initial result"); await race.flush();
  const names = race.nodes().filter(node => node.props.className === "operations-row-case").map(node => node.props.children);
  assert.deepEqual(names, ["new result"]); race.dispose();

  // URL can change before React commits its next render. The callback must guard it.
  const guard = harness(); await guard.flush(); guard.type("stale"); await guard.flush();
  guard.location.search = canonical; guard.advance(300); await guard.flush(); assert.equal(guard.writes.length, 0); guard.dispose();
  console.log("Operations search debounce: PASS (fake 300ms clock, URL/history/filter/pagination interactions, retained reference mounts, stale response and unmount guards; no browser)");
}
void main();
