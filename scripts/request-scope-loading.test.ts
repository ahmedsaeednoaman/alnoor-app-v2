import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import type { ScopeSnapshot } from "../src/lib/auth/client-request-scope";

type Element = { type: unknown; props: Record<string, unknown> };
const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
let snapshot: ScopeSnapshot = { status: "checking", scope: null, expiresAt: null };
let retries = 0, reloads = 0;
const controller = { getSnapshot: () => snapshot, revalidate: () => { retries++; } };
const react = {
  createContext: () => ({ Provider: "scope" }),
  useState: (init: () => unknown) => [init()],
  useMemo: (factory: () => unknown) => factory(),
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
  useEffect: () => {}, // Lifecycle/security covered by request-scope.test.ts.
};
function load(path: string, imports: Record<string, unknown>) {
  const exports: Record<string, (props?: Record<string, unknown>) => Element> = {};
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, window: { location: { reload: () => { reloads++; } } },
    require(name: string) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (name in imports) return imports[name];
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return exports;
}
const loading = load("src/components/shell/app-loading.tsx", { "next/image": { default: "img" } });
const provider = load("src/components/auth/request-scope-provider.tsx", {
  "@/components/shell/app-loading": loading,
  "@/lib/auth/client-request-scope": { createRequestScopeController: () => controller },
  "@/lib/auth/authenticated-cache": { createAuthenticatedCache: () => ({ cache: new Map() }), authenticatedSWRSettings: {} },
  swr: { SWRConfig: "swr" },
});
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value) || !("type" in value)) return [];
  const node = value as Element;
  if (typeof node.type === "function") return nodes(node.type(node.props));
  return [node, ...nodes(node.props.children)];
}
const child = jsx("protected-shell", { children: "private patient data" });
function render() { return nodes(provider.RequestScopeProvider({ initial: { scope: "session" }, children: child })); }
function gate(tree: Element[], hidden: boolean) {
  const wrapper = tree.find(n => n.type === "div" && "hidden" in n.props);
  assert.ok(wrapper); assert.equal(wrapper.props.hidden, hidden); assert.equal(wrapper.props.inert, hidden);
  assert.ok(tree.some(n => n.type === "swr"));
}
for (const phase of ["checking", "active", "checking", "blocked", "active"] as const) {
  snapshot = { status: phase, scope: phase === "active" ? "session" : null, expiresAt: null };
  const tree = render(); gate(tree, phase !== "active");
  const surface = tree.find(n => n.type === "section");
  if (phase === "active") { assert.equal(surface, undefined); continue; }
  assert.ok(surface); assert.equal(surface.props.dir, "rtl");
  assert.ok(String(surface.props.className).includes("app-route-loading--fullscreen"));
  assert.equal(surface.props["aria-busy"], phase === "checking");
  assert.equal(surface.props.role, phase === "blocked" ? "alert" : "status");
  assert.equal(tree.filter(n => n.type === "button").length, phase === "blocked" ? 2 : 0);
  assert.equal(tree.some(n => n.props.className === "app-route-loading__progress"), phase === "checking");
  if (phase === "blocked") for (const button of tree.filter(n => n.type === "button")) (button.props.onClick as () => void)();
}
assert.equal(retries, 1); assert.equal(reloads, 1);
snapshot = { status: "blocked", scope: null, expiresAt: null, reason: "access-denied" };
assert.ok(JSON.stringify(render()).includes("لم تعد لديك صلاحية الوصول"));
const route = nodes(loading.AppLoading());
assert.equal(route[0].props.className, "app-route-loading");
assert.equal(route[0].props["aria-busy"], true);
assert.ok(JSON.stringify(route).includes("جاري التحميل..."));
console.log("Request-scope loading: PASS (checking/active/error transitions, private gate, SWR boundary, RTL loader, denial copy, retry/reload and route defaults; mocked render only)");
