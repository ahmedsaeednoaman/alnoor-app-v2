import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as validation from "../src/lib/operations/validation";
import * as monthly from "../src/lib/pagination/monthly";
import * as requestEffect from "../src/lib/accounting/review-request-effect";
import * as grouping from "../src/lib/accounting/financial-review-grouping";

function load(file: string, require: (name: string) => unknown, globals = {}) {
  const exports: Record<string, (...args: any[]) => any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  vm.runInNewContext(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, require, URL, URLSearchParams, AbortController, ...globals });
  return exports;
}
async function main() {
  const september = [
    { id: "synthetic-endoscopy", type: "endoscopy", operationDate: "2026-09-11", operationTime: "12:00:00", dailySequence: 1, procedures: "إجراء يتضمن تفتيت", reviewStatus: "awaiting_review" },
    { id: "synthetic-contract", type: "contract", operationDate: "2026-09-09", operationTime: "12:00:00", dailySequence: 1, procedures: "", reviewStatus: "awaiting_review" },
  ];
  for (const dataset of [september, [...september, { ...september[0], id: "synthetic-lithotripsy", type: "lithotripsy" }]]) {
  for (const type of ["lithotripsy", "endoscopy", "contract"] as const) {
  const selected = dataset.filter(row => row.type === type);
  const query = `type=${type}&pageSize=25&page=1&period=month&year=2026&month=9`;
  const filters = validation.financialReviewFilterSchema.parse(Object.fromEntries(new URLSearchParams(query)));
  const range = validation.resolveFinancialReviewPagination(filters);
  assert.equal(range.from, "2026-09-01"); assert.equal(range.toExclusive, "2026-10-01"); assert.equal(range.offset, 0);
  const queries: string[] = [];
  const service = load("src/lib/accounting/review.ts", name => {
    if (name.endsWith("/validation")) return validation;
    if (name === "@/db/client") return { postgresClient: { unsafe: async (sql: string, params: unknown[]) => {
      queries.push(sql);
      assert.match(sql, /^select /i, "read path must not manufacture review records");
      if (sql.includes("count(*)::text") || sql.startsWith("SELECT o.id FROM")) {
        assert.match(sql, /left join operation_financial_reviews/);
        assert.match(sql, /o.status='recorded'/);
        assert.match(sql, /o.type=\$1::operation_type/);
        assert.match(sql, /o.operation_date>=\$2::date/); assert.match(sql, /o.operation_date<\$3::date/);
        assert.deepEqual(Array.from(params).slice(0, 3), [type, "2026-09-01", "2026-10-01"]);
        assert.doesNotMatch(sql, /fr\.id is not null|template|invoice|posted|fr\.status=/);
        assert.match(sql, /o.archived_at IS NULL/);
        return sql.includes("count(*)::text") ? [{ total: String(selected.length) }] : selected.map(row => ({ id: row.id }));
      }
      return sql.includes("accounting_mode='direct_items'") ? [] : selected;
    } } };
    return {};
  });
  const route = load("src/app/api/v1/financial-reviews/route.ts", name => {
    if (name === "next/server") return { NextResponse: { json: (value: unknown) => Response.json(value) } };
    if (name.endsWith("/guards")) return { requirePermission: async (permission: string) => assert.equal(permission, "accounting.review") };
    if (name.endsWith("/validation")) return validation;
    if (name.endsWith("/review")) return service;
    return { requestId: () => "test", operationError: (error: unknown) => { throw error; } };
  });
  const response = await route.GET(new Request(`http://localhost/api/v1/financial-reviews?${query}`));
  const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.operations.length, selected.length); assert.equal(body.pagination.total, selected.length);
  assert.ok(body.operations.every((row: { type: string }) => row.type === type));
  assert.equal(queries.length, selected.length ? 4 : 1);

  // Run the actual Workbench fetch effect, with React host and HTTP mocked.
  const states: unknown[] = [], effects: Array<() => unknown> = []; let cursor = 0;
  const react = {
    useState(initial: unknown) { const slot = cursor++; if (!(slot in states)) states[slot] = initial; return [states[slot], (value: unknown) => { states[slot] = value; }]; },
    useRef: (current: unknown) => ({ current }), useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(), useEffect: (fn: () => unknown) => effects.push(fn),
  };
  const workbench = load("src/components/accounting/financial-review-workbench.tsx", name => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }) };
    if (name === "next/navigation") return { useSearchParams: () => new URLSearchParams(query) };
    if (name.endsWith("/monthly")) return monthly;
    if (name.endsWith("/financial-review-grouping")) return grouping;
    if (name.endsWith("/review-request-effect")) return requestEffect;
    return {};
  }, { process: { env: { NODE_ENV: "test" } }, window: { location: { search: `?${query}` } }, fetch: async (url: string) => Response.json(url.includes("/layout/") ? { layout: [], operationFields: [] } : body) });
  const render = () => { cursor = 0; return workbench.FinancialReviewWorkbench({ defaultMonth: { year: 2026, month: 9 } }); };
  render();
  const cleanup = effects.map(effect => effect());
  for (let i = 0; i < 30; i++) await Promise.resolve();
  assert.deepEqual(states[0], body.operations, "the actual client load retains API operations");
  assert.equal(grouping.groupFinancialReview(body.operations, type).reduce((sum, day) => sum + day.casesCount, 0), selected.length);
  function nodes(value: unknown): Array<{ type: { name?: string }; props: Record<string, unknown> }> {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!value || typeof value !== "object" || !("props" in value)) return [];
    const node = value as { type: { name?: string }; props: Record<string, unknown> };
    return [node, ...nodes(node.props.children)];
  }
  for (const [mode, component] of [["grouped", "GroupedFinancialReview"], ["table", "ReviewTable"]]) {
    states[7] = mode;
    const tree = nodes(render());
    const view = tree.find(node => node.type?.name === component);
    if (selected.length) assert.deepEqual(view?.props.rows, body.operations);
    else assert.equal(view, undefined, "zero lithotripsy rows use empty state in both modes");
  }
  cleanup.forEach(fn => { if (typeof fn === "function") fn(); });
  }
  }
  console.log("Financial review type routing PASS: endoscopy with تفتيت procedure stays endoscopy, contract isolated, absent lithotripsy empty; grouped/table retain API rows; September bounds and archive filtering (synthetic mocked DB/HTTP; actual localhost data NOT verified)");
}
void main();
