import assert from "node:assert/strict";
import vm from "node:vm";
import { buildSync } from "esbuild";
import { createAuthenticatedCache, authenticatedSWRSettings } from "../src/lib/auth/authenticated-cache";
import { createRequestScopeController } from "../src/lib/auth/client-request-scope";

type Node = { type: unknown; props: Record<string, unknown> };
type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
export type Mounted<T = unknown> = { run: () => T; value: T; slots: Slot[]; dirty: boolean; active: boolean };
export type Request = { url: string; method: string; body: string | undefined; signal?: AbortSignal | null; resolve: (response: Response) => void; reject: (error: Error) => void };
export function nodes(node: unknown): Node[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object" || !("props" in node) || !("type" in node)) return [];
  const value = node as Node;
  return [value, ...nodes(value.props.children)];
}
const code = buildSync({ entryPoints: ["scripts/cache-test-entry.ts"], bundle: true, write: false,
  format: "cjs", platform: "browser", target: "es2022", external: ["react", "react/jsx-runtime", "next/navigation", "@/components/auth/request-scope-provider"],
}).outputFiles[0].text;

export async function cacheRuntime(name = "account-a") {
  let identity = { scope: name, expiresAt: "2099-01-01T00:00:00Z" };
  const auth = createRequestScopeController(identity, async () => identity, () => {});
  const store = createAuthenticatedCache(auth), disconnect = store.connect();
  const mounted = new Set<Mounted>();
  const requests: Request[] = [];
  let current: Mounted, cursor = 0, now = Date.now(), confirmResult = true;
  let effects: Array<() => void> = [];
  const effect = (callback: () => void | (() => void), deps?: unknown[]) => {
    const owner = current, slot = owner.slots[cursor++] ??= {};
    if (!deps || !slot.deps || deps.some((value, i) => !Object.is(value, slot.deps?.[i]))) {
      slot.deps = deps;
      effects.push(() => { if (owner.active) { slot.cleanup?.(); slot.cleanup = callback() || undefined; } });
    }
  };
  function memo(factory: () => unknown, deps: unknown[]) {
    const slot = current.slots[cursor++] ??= {};
    if (!slot.deps || deps.some((value, i) => !Object.is(value, slot.deps?.[i]))) { slot.value = factory(); slot.deps = deps; }
    return slot.value;
  }
  const react = {
    createElement: (type: unknown, props: Record<string, unknown>, children: unknown) => ({ type, props: { ...props, children } }),
    createContext: (value: unknown) => { const context = { value, Provider: {} }; context.Provider = context; return context; },
    useContext: (context: { value: unknown }) => context.value,
    useId: () => memo(() => `id-${mounted.size}-${cursor}`, []),
    useRef: (value: unknown) => memo(() => ({ current: value }), []),
    useMemo: memo,
    useCallback: (callback: unknown, deps: unknown[]) => memo(() => callback, deps),
    useEffect: effect, useLayoutEffect: effect, useDebugValue() {},
    useState(initial: unknown) {
      const owner = current, slot = owner.slots[cursor++] ??= { value: typeof initial === "function" ? initial() : initial };
      return [slot.value, (next: unknown) => {
        const value = typeof next === "function" ? next(slot.value) : next;
        if (!Object.is(value, slot.value)) { slot.value = value; owner.dirty = true; }
      }];
    },
    useSyncExternalStore(subscribe: (listener: () => void) => () => void, snapshot: () => unknown) {
      const owner = current;
      effect(() => subscribe(() => { owner.dirty = true; }), [subscribe]);
      return snapshot();
    },
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const exported: Record<string, (props?: never) => unknown> = {};
  const compiledModule = { exports: exported };
  const windowMock = { location: { origin: "https://alnoor.test" }, addEventListener() {}, removeEventListener() {}, requestAnimationFrame: (fn: () => void) => { queueMicrotask(fn); return 1; } };
  vm.runInNewContext(code, {
    module: compiledModule, exports: exported, console, URL, AbortController, DOMException, setTimeout, clearTimeout, queueMicrotask,
    Date: class extends Date { static now() { return now; } },
    window: windowMock, document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    requestAnimationFrame: windowMock.requestAnimationFrame, cancelAnimationFrame() {},
    confirm: () => confirmResult, alert: () => {},
    fetch: (url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      requests.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined, signal: init?.signal, resolve, reject });
    }),
    require(name: string) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "next/navigation") return { useRouter: () => ({ push() {}, refresh() {}, back() {} }) };
      if (name.endsWith("request-scope-provider")) return { useAuthenticatedRequestScope: () => {
        const snapshot = react.useSyncExternalStore(auth.subscribe, auth.getSnapshot);
        return { ...snapshot as object, capture: auth.capture, isCurrent: auth.isCurrent, invalidate: auth.invalidate, deny: auth.deny, revalidate: auth.revalidate };
      } };
      throw new Error(`Unexpected external ${name}`);
    },
  });
  const api = compiledModule.exports;
  const runtime = {
    api, auth, store, requests,
    mount<T>(run: () => T) {
      const instance: Mounted<T> = { run, value: undefined as T, slots: [], dirty: true, active: true };
      mounted.add(instance); return instance;
    },
    async flush() {
      for (let i = 0; i < 60; i++) {
        for (const instance of mounted) if (instance.active && instance.dirty) {
          instance.dirty = false; current = instance; cursor = 0; instance.value = instance.run();
        }
        const pending = effects; effects = []; pending.forEach(run => run());
        await Promise.resolve();
      }
      assert.ok(![...mounted].some(instance => instance.active && instance.dirty), "render loop must settle");
    },
    unmount(instance: Mounted) { instance.active = false; instance.slots.forEach(slot => slot.cleanup?.()); mounted.delete(instance); },
    async activate() { await auth.revalidate(); await runtime.flush(); },
    async changeIdentity(scope: string) { identity = { ...identity, scope }; await runtime.activate(); },
    setConfirm(value: boolean) { confirmResult = value; },
    advance(ms: number) { now += ms; },
    async invoke(instance: Mounted, match: (node: Node) => boolean, event = "onClick", argument: unknown = { stopPropagation() {} }) {
      const node = nodes(instance.value).find(match); assert.ok(node, "control exists");
      await (node.props[event] as (argument: unknown) => unknown)(argument); await runtime.flush();
    },
    dispose() { for (const instance of [...mounted]) runtime.unmount(instance); disconnect(); auth.dispose(); },
  };
  // Execute SWR's real provider initialization, then install its returned context.
  const provider = runtime.mount(() => api.SWRConfig({ value: { ...authenticatedSWRSettings, provider: () => store.cache }, children: null } as never) as Node);
  await runtime.flush();
  (provider.value.type as { value: unknown }).value = provider.value.props.value;
  return runtime;
}
