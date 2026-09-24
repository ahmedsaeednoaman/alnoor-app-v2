import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import type { BuilderField, BuilderTemplate } from "../src/components/operations/work-form-types";

// Execute the actual component/effect with a deterministic production-style hook
// boundary. No DOM, database, network, or additional test dependency is used.
type Node = { type: unknown; props: Record<string, unknown> };
type Props = {
  template: BuilderTemplate; values: Record<string, number>; errors: Record<string, string>;
  canManageCatalogs: boolean; onChange: (key: string, value: unknown) => void;
};
const source = ts.transpileModule(readFileSync("src/components/operations/work-form-renderer.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const field: BuilderField = {
  id: "session", sectionId: "section", stableKey: "session_count", label: "الجلسة", description: null,
  fieldType: "select", required: true, multiple: false, sortOrder: 0, isSystemField: true,
  smartDropdownSource: null, minSelections: null, maxSelections: null, showInForm: true,
  showInDetails: true, showInFinancialReview: false, showInPrint: true,
  isFinancial: false, financialEffect: null, archivedAt: null,
};
function template(fields: BuilderField[], archivedAt: string | null = null): BuilderTemplate {
  return { id: "template", operationType: "contract", name: "custom", version: 1, status: "published", updatedAt: "",
    sections: [{ id: "section", stableKey: "basic", label: "البيانات", description: null,
      sortOrder: 0, isSystemSection: true, archivedAt, fields }] };
}
function harness() {
  let options: unknown = [];
  let updates = 0;
  let dependencies: unknown[] | undefined;
  let cleanup: (() => void) | undefined;
  let pending: (() => (() => void) | void) | undefined;
  const requests: Array<{ url: string; signal: AbortSignal; response: ReturnType<typeof deferred<Response>> }> = [];
  const changes: unknown[] = [];
  const values = { session_count: 2 };
  const moduleExports: { WorkFormRenderer?: (props: Props) => Node } = {};
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  vm.runInNewContext(source, {
    exports: moduleExports, AbortController,
    fetch: (url: string, init: { signal: AbortSignal }) => {
      const response = deferred<Response>(); requests.push({ url, signal: init.signal, response }); return response.promise;
    },
    require: (name: string) => {
      if (name === "react") return {
        useState: () => [options, (next: unknown) => { options = next; updates++; }],
        useEffect: (effect: () => (() => void) | void, next: unknown[]) => {
          if (!dependencies || next.some((item, index) => !Object.is(item, dependencies?.[index]))) {
            dependencies = next; pending = effect;
          }
        },
      };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "./work-form-rendering") return { selectOptions: () => [], sourceCatalogType: {} };
      return {};
    },
  });
  return {
    requests, changes, values,
    get options() { return JSON.parse(JSON.stringify(options)); },
    get updates() { return updates; },
    render(current: BuilderTemplate) {
      assert.ok(moduleExports.WorkFormRenderer);
      const tree = moduleExports.WorkFormRenderer({ template: current, values, errors: {}, canManageCatalogs: false,
        onChange: (...args) => { changes.push(args); } });
      if (pending) { cleanup?.(); cleanup = pending() || undefined; pending = undefined; }
      return tree;
    },
    unmount() { cleanup?.(); },
  };
}
function controls(node: unknown): Node[] {
  if (Array.isArray(node)) return node.flatMap(controls);
  if (!node || typeof node !== "object" || !("type" in node) || !("props" in node)) return [];
  const element = node as Node;
  if (typeof element.type === "function") return controls(element.type(element.props));
  return [element, ...controls(element.props.children)];
}
const success = () => new Response(JSON.stringify({ sessions: [{ sessionNumber: 2, name: "الجلسة الثانية" }] }));
async function main() {
  for (const current of [template([]), template([{ ...field, archivedAt: "2026-01-01" }]),
    template([field], "2026-01-01"), template([{ ...field, showInForm: false }]),
    ...(["textarea", "boolean", "smart_single", "smart_multi"] as const).map(fieldType => template([{ ...field, fieldType }]))]) {
    const h = harness(); h.render(current); await flush(); assert.equal(h.requests.length, 0); h.unmount();
  }
  const h = harness();
  h.render(template([field])); await flush(); assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, "/api/v1/lithotripsy/sessions");
  h.requests[0].response.resolve(success()); await flush();
  assert.deepEqual(h.options, [{ value: "2", label: "الجلسة الثانية" }]);
  const select = controls(h.render(template([field]))).find(node => node.type === "select");
  assert.equal(select?.props.value, "2");
  assert.deepEqual(h.values, { session_count: 2 }); assert.equal(h.changes.length, 0);
  h.render(template([field, { ...field, id: "second" }])); await flush(); assert.equal(h.requests.length, 1);
  h.render(template([])); await flush(); assert.equal(h.requests.length, 1); assert.deepEqual(h.options, []);
  assert.equal(h.requests[0].signal.aborted, true);
  h.render(template([field])); await flush(); assert.equal(h.requests.length, 2);
  h.unmount(); const updates = h.updates;
  h.requests[1].response.resolve(success()); await flush(); assert.equal(h.updates, updates);

  // Late JSON parsing after hide/re-show must not replace the new request's data.
  const stale = harness(); stale.render(template([field])); await flush();
  const body = deferred<unknown>();
  const response = success(); response.json = () => body.promise;
  stale.requests[0].response.resolve(response); await flush();
  stale.render(template([{ ...field, showInForm: false }])); await flush();
  assert.equal(stale.requests.length, 1); assert.deepEqual(stale.options, []);
  stale.render(template([field])); await flush();
  stale.requests[1].response.resolve(success()); await flush();
  const beforeLate = stale.updates;
  body.resolve({ sessions: [{ sessionNumber: 99, name: "stale" }] }); await flush();
  assert.equal(stale.updates, beforeLate); assert.deepEqual(stale.options, [{ value: "2", label: "الجلسة الثانية" }]);
  stale.unmount();
  for (const failure of ["network", "http", "json"]) {
    const failed = harness(); failed.render(template([field])); await flush();
    if (failure === "network") failed.requests[0].response.reject(new Error("offline"));
    else failed.requests[0].response.resolve(new Response(failure === "json" ? "invalid" : "", { status: failure === "http" ? 503 : 200 }));
    await flush(); assert.deepEqual(failed.options, []); assert.deepEqual(failed.values, { session_count: 2 });
    assert.equal(failed.changes.length, 0); failed.unmount();
  }
  console.log("WorkFormRenderer sessions lifecycle: PASS (A–I, branch precedence, duplicate consumers, unmount and delayed JSON; mocked hooks/fetch, no browser)");
}
void main();
