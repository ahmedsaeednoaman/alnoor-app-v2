import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { financialReviewFilterSchema, resolveFinancialReviewPagination } from "../src/lib/operations/validation";
import { canonicalReviewQuery, currentCairoMonth, reviewCustomQuery, reviewMonthQuery, reviewPageCorrection, shiftCalendarMonth, updateReviewQuery } from "../src/lib/pagination/monthly";

const now = new Date("2026-08-31T22:30:00Z");
const resolve = (input: unknown) => resolveFinancialReviewPagination(financialReviewFilterSchema.parse(input), now);
assert.deepEqual(resolve({}), { period: "month", from: "2026-09-01", to: "2026-09-30", toExclusive: "2026-10-01", page: 1, pageSize: 25, offset: 0, legacyPaging: false });
assert.equal(resolve({ period: "month", year: 2026, month: 9 }).toExclusive, "2026-10-01");
assert.deepEqual(shiftCalendarMonth({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
assert.deepEqual(shiftCalendarMonth({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
for (const pageSize of [25, 50, 100]) assert.equal(resolve({ pageSize }).pageSize, pageSize);
for (const value of [1, 24, 26, 101]) assert.equal(financialReviewFilterSchema.safeParse({ pageSize: value }).success, false);
for (const invalid of [{ period: "month", year: 2026 }, { month: 9, year: 2026 }, { period: "month", year: 1999, month: 9 }, { period: "month", year: 2101, month: 9 }, { period: "month", year: 2026, month: 13 }, { page: 1, limit: 25 }, { pageSize: 50, offset: 0 }, { period: "custom", from: "2026-09-01" }, { period: "month", year: 2026, month: 9, date: "2026-09-01" }, { period: "custom", from: "2026-09-02", to: "2026-09-01" }, { invoiceStatus: "pending" }]) assert.equal(financialReviewFilterSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
assert.equal(resolve({ limit: 100 }).from, null, "explicit legacy callers retain historical scope");
assert.equal(resolve({ offset: 50 }).pageSize, 50);
assert.equal(resolve({ limit: 40, from: "2026-08-01" }).from, "2026-08-01");
assert.equal(resolve({ limit: 40, to: "2026-08-31" }).toExclusive, "2026-09-01");
assert.equal(resolve({ date: "2026-09-07" }).toExclusive, "2026-09-08");
assert.equal(resolve({ limit: 25, date: "2026-09-07", from: "2026-09-01", to: "2026-09-30" }).from, "2026-09-07");

const initial = canonicalReviewQuery("", currentCairoMonth(now));
assert.equal(initial, "type=lithotripsy&pageSize=25&page=1&period=month&year=2026&month=9");
assert.equal(canonicalReviewQuery(initial, currentCairoMonth(now)), initial);
const doctor = "11111111-1111-4111-8111-111111111111", hospital = "22222222-2222-4222-8222-222222222222";
const active = new URLSearchParams({ type: "endoscopy", period: "month", year: "2026", month: "9", page: "7", pageSize: "50", doctorId: doctor, hospitalId: hospital, reviewStatus: "reviewed", search: "case" }).toString();
for (const key of ["type", "doctorId", "hospitalId", "reviewStatus", "search", "pageSize"]) {
  const next = new URLSearchParams(updateReviewQuery(active, { [key]: key === "pageSize" ? "100" : "changed" }));
  assert.equal(next.get("page"), "1"); assert.equal(next.get("month"), "9");
}
const changed = new URLSearchParams(reviewMonthQuery(active, { year: 2027, month: 1 }));
assert.equal(changed.get("page"), "1");
for (const key of ["type", "doctorId", "hospitalId", "reviewStatus", "search", "pageSize"]) assert.equal(changed.get(key), new URLSearchParams(active).get(key));
const custom = reviewCustomQuery(active, "2026-08-01", "2026-09-07");
assert.equal(new URLSearchParams(custom).get("period"), "custom");
for (const key of ["year", "month", "date"]) assert.equal(new URLSearchParams(custom).has(key), false);
const monthly = reviewMonthQuery(custom, { year: 2026, month: 9 });
for (const key of ["from", "to", "date", "limit", "offset"]) assert.equal(new URLSearchParams(monthly).has(key), false);
assert.equal(new URLSearchParams(reviewPageCorrection(active, { page: 7, totalPages: 2, total: 60 })!).get("page"), "2");
assert.equal(reviewPageCorrection(initial, { page: 1, totalPages: 0, total: 0 }), null);
assert.equal(new URLSearchParams(reviewPageCorrection(active, { page: 1, totalPages: 0, total: 0 })!).get("page"), "1");

// Recording database boundary exercises the production list service without live writes.
async function main() {
  const { postgresClient } = await import("../src/db/client");
  const { listFinancialReviewRows } = await import("../src/lib/accounting/review");
  const list = async (filters: Parameters<typeof listFinancialReviewRows>[0]) => {
    const result = await listFinancialReviewRows(filters);
    return { ...result, operations: result.operations as Array<typeof result.operations[number] & { id: string; type: string; operationDate: string }> };
  };
  const fixtures = Array.from({ length: 64 }, (_, i) => ({ id: String(i + 1), type: i < 60 ? "lithotripsy" : i < 62 ? "endoscopy" : "contract", operationDate: i === 59 ? "2026-08-31" : `2026-09-${String(i % 28 + 1).padStart(2, "0")}`, dailySequence: i + 1, caseName: `case ${i}`, referenceNumber: `ref${i}`, doctorId: i % 2 ? doctor : "other", hospitalId: i % 3 ? hospital : "other", reviewStatus: i % 2 ? "reviewed" : "awaiting_review", mainAmount: "1000", doctorAccountAmount: "900", totalItems: "-100", additionTotal: "200", deductionTotal: "300", definitionValues: { fee: 100 }, paid: "100" }));
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const filtered = (sql: string, values: unknown[]) => fixtures.filter(row => {
    for (const [field, pattern, compare] of [
      ["type", /o\.type=\$(\d+)::operation_type/, (a: string, b: string) => a === b],
      ["operationDate", /o\.operation_date>=\$(\d+)::date/, (a: string, b: string) => a >= b],
      ["operationDate", /o\.operation_date<\$(\d+)::date/, (a: string, b: string) => a < b],
      ["doctorId", /o\.doctor_id=\$(\d+)::uuid/, (a: string, b: string) => a === b],
      ["hospitalId", /o\.hospital_id=\$(\d+)::uuid/, (a: string, b: string) => a === b],
      ["reviewStatus", /coalesce\(fr.status,'awaiting_review'\)=\$(\d+)/, (a: string, b: string) => a === b],
    ] as const) { const match = sql.match(pattern); if (match && !compare(String(row[field]), String(values[Number(match[1]) - 1]))) return false; }
    const search = sql.match(/o.case_name ilike '%'\|\|\$(\d+)/);
    return !search || row.caseName.includes(String(values[Number(search[1]) - 1])) || row.referenceNumber.includes(String(values[Number(search[1]) - 1]));
  }).sort((a, b) => b.operationDate.localeCompare(a.operationDate) || b.dailySequence - a.dailySequence || b.id.localeCompare(a.id));
  const original = postgresClient.unsafe;
  postgresClient.unsafe = (async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.startsWith("SELECT count(*)")) return [{ total: String(filtered(sql, values).length) }];
    if (sql.startsWith("SELECT o.id FROM")) return (sql.includes(" LIMIT ") ? filtered(sql, values).slice(Number(values.at(-1)), Number(values.at(-1)) + Number(values.at(-2))) : filtered(sql, values)).map(row => ({ id: row.id }));
    if (sql.startsWith("SELECT o.id,o.type")) {
      assert.match(sql, /WHERE o.id=any\(\$1::uuid\[\]\)/);
      const projection = sql.slice(0, sql.indexOf(" FROM operations o"));
      assert.equal(createHash("sha256").update(projection).digest("hex"), "5204286c60c1aabc7082ae5b1e144b39944d995f0290618a842a7d6c354e7b64", "financial SELECT expressions remain unchanged");
      return (values[0] as string[]).map(id => ({ ...fixtures.find(row => row.id === id)! }));
    }
    if (sql.startsWith("select operation_id")) return (values[0] as string[]).filter(id => Number(id) % 5 === 0).map(operationId => ({ operationId, due: "500", received: "700" }));
    throw new Error(`Unexpected query: ${sql}`);
  }) as unknown as typeof original;
  const query = (extra: Record<string, unknown> = {}) => financialReviewFilterSchema.parse({ type: "lithotripsy", period: "month", year: 2026, month: 9, ...extra });
  try {
    const first = await list(query());
    assert.equal(first.pagination.total, 59); assert.equal(first.pagination.totalPages, 3); assert.equal(first.operations.length, 25);
    const [count, ids] = calls;
    assert.ok(ids.sql.includes(count.sql.slice(count.sql.indexOf("FROM operations"))), "COUNT and IDs share all predicates");
    assert.doesNotMatch(count.sql, /string_agg|sum\(|jsonb_object_agg/);
    assert.match(ids.sql, /ORDER BY o.operation_date desc,o.daily_sequence desc,o.id desc LIMIT .* OFFSET/);
    calls.length = 0;
    const all = await list(query({ pageSize: "all", page: 8 }));
    assert.equal(all.operations.length, 59);
    assert.deepEqual(all.pagination, { page: 1, pageSize: "all", total: 59, totalPages: 1, hasNext: false, hasPrevious: false });
    assert.doesNotMatch(calls[1].sql, /LIMIT|OFFSET/);
    assert.ok(calls[1].sql.includes(calls[0].sql.slice(calls[0].sql.indexOf("FROM operations"))));
    assert.ok(calls[1].values.includes("2026-09-01")); assert.ok(calls[1].values.includes("2026-10-01"));
    for (const row of first.operations) assert.deepEqual(all.operations.find(other => other.id === row.id), row, "all and numbered mode preserve every summary value");
    const emptyAll = await list(query({ pageSize: "all", month: 7 }));
    assert.deepEqual(emptyAll.pagination, { page: 1, pageSize: "all", total: 0, totalPages: 0, hasNext: false, hasPrevious: false });
    const second = await list(query({ page: 2 }));
    assert.equal(second.operations.length, 25);
    assert.ok(second.operations.every(row => !first.operations.some(other => other.id === row.id)));
    for (const row of [...first.operations, ...second.operations]) {
      const direct = Number(row.id) % 5 === 0;
      assert.equal(row.doctorAccountAmount, direct ? 500 : 900);
      assert.equal(row.paid, direct ? 700 : 100);
      assert.equal(row.finalBalance, direct ? 0 : 900);
      assert.equal(row.remaining, direct ? 0 : 800);
      assert.equal(row.mainAmount, 1000); assert.equal(row.totalItems, -100); assert.equal(row.totalCosts, 300);
      assert.deepEqual(row.definitionValues, { fee: 100 });
    }
    for (const type of ["lithotripsy", "endoscopy", "contract"]) {
      const result = await list(query({ type, pageSize: 100 }));
      assert.ok(result.operations.every(row => row.type === type));
    }
    for (const extra of [{ doctorId: doctor }, { hospitalId: hospital }, { reviewStatus: "reviewed" }, { search: "ref1" }, { doctorId: doctor, hospitalId: hospital, reviewStatus: "reviewed", search: "case" }]) {
      calls.length = 0;
      const result = await list(query({ ...extra, pageSize: "all" }));
      assert.equal(result.pagination.total, result.operations.length);
      assert.ok(calls[1].sql.includes(calls[0].sql.slice(calls[0].sql.indexOf("FROM operations"))));
    }
    calls.length = 0;
    const empty = await list(query({ month: 7, page: 7 }));
    assert.deepEqual(empty.pagination, { page: 1, pageSize: 25, total: 0, totalPages: 0, hasNext: false, hasPrevious: false });
    assert.equal(calls.length, 1, "empty scope does not hydrate summaries");
    const far = await list(query({ page: 7 }));
    const corrected = reviewPageCorrection("page=7", far.pagination)!;
    assert.equal(new URLSearchParams(corrected).get("page"), "3");
    const last = await list(query({ page: 3 }));
    assert.equal(reviewPageCorrection(corrected, last.pagination), null);
    assert.equal(last.operations.length, 9);
    const customResult = await list(financialReviewFilterSchema.parse({ type: "lithotripsy", period: "custom", from: "2026-09-01", to: "2026-09-03", pageSize: 100 }));
    assert.ok(customResult.operations.every(row => String(row.operationDate) <= "2026-09-03"));
    const legacy = await list(financialReviewFilterSchema.parse({ type: "lithotripsy", limit: 10, offset: 10 }));
    assert.equal(legacy.operations.length, 10); assert.equal(legacy.limit, 10); assert.equal(legacy.offset, 10);
  } finally { postgresClient.unsafe = original; await postgresClient.end(); }
  const ui = readFileSync("src/components/accounting/financial-review-workbench.tsx", "utf8");
  assert.doesNotMatch(ui, /new URLSearchParams\(\{ type, limit/);
  assert.match(ui, /\}, \[load\]\)/); assert.match(ui, /\}, \[loadLayout\]\)/);
  assert.match(ui, /AbortController/); assert.match(ui, /requestGeneration !==|requestGeneration === requestGenerationRef.current/);
  const route = readFileSync("src/app/api/v1/financial-reviews/route.ts", "utf8");
  assert.match(route, /requirePermission\("accounting.review"\)/);
  const page = readFileSync("src/app/(shell)/accounts/review/page.tsx", "utf8");
  assert.ok(page.indexOf("if (canonical !==") < page.indexOf("return <FinancialReviewWorkbench"));
  console.log("Financial Review monthly pagination: PASS (mock database boundary; no live DB writes)");
}
void main();

// Explicit month-only all mode and shared URL transition contracts.
const allInput = { period: "month", year: 2026, month: 9, pageSize: "all", page: 8 };
assert.equal(resolve(allInput).page, 1);
assert.equal(resolve(allInput).offset, 0);
assert.equal(resolve(allInput).pageSize, "all");
for (const scope of [{}, { period: "year", year: 2026 }, { period: "week" }, { period: "custom", from: "2020-01-01", to: "2026-09-01" }, { date: "2026-09-01" }, { limit: 100 }, { ...allInput, offset: 0 }, { period: "month", year: 2026 }, { ...allInput, from: "2026-09-01" }]) {
  assert.equal(financialReviewFilterSchema.safeParse({ ...scope, pageSize: "all" }).success, false);
}
const allQuery = updateReviewQuery(active, { pageSize: "all" });
assert.equal(new URLSearchParams(allQuery).get("page"), "1");
assert.equal(new URLSearchParams(updateReviewQuery(allQuery, { page: "8" })).get("page"), "1");
for (const year of [2025, 2027]) {
  const q = new URLSearchParams(reviewMonthQuery(allQuery, { year, month: 9 }));
  assert.equal(q.get("year"), String(year)); assert.equal(q.get("month"), "9");
  assert.equal(q.get("page"), "1"); assert.equal(q.get("pageSize"), "all");
  for (const key of ["type", "doctorId", "hospitalId", "search", "invoiceStatus", "reviewStatus"]) assert.equal(q.get(key), new URLSearchParams(allQuery).get(key));
  assert.equal(q.has("limit"), false); assert.equal(q.has("offset"), false);
}
const safeCustom = reviewCustomQuery(allQuery, "2026-08-01", "2026-09-30");
assert.equal(new URLSearchParams(safeCustom).get("pageSize"), "25");
assert.equal(new URLSearchParams(reviewMonthQuery(safeCustom, { year: 2026, month: 9 })).get("pageSize"), "25");

const requestAll = updateReviewQuery("type=lithotripsy&period=month&year=2026&month=9&page=8&pageSize=25", { pageSize: "all" });
assert.equal(`/api/v1/financial-reviews?${requestAll}`, "/api/v1/financial-reviews?type=lithotripsy&period=month&year=2026&month=9&page=1&pageSize=all");
assert.equal(new URLSearchParams(canonicalReviewQuery("period=month&year=2026&month=9&page=8&pageSize=all", currentCairoMonth(now))).get("page"), "1");
assert.match(readFileSync("src/components/accounting/financial-review-workbench.tsx", "utf8"), /fetch\(`\/api\/v1\/financial-reviews\?\$\{queryString\}`/);

const reviewUi = readFileSync("src/components/accounting/financial-review-workbench.tsx","utf8");
assert.equal((reviewUi.match(/<BottomPagination /g)||[]).length,1);
assert.equal((reviewUi.match(/<CompactMonthFilter /g)||[]).length,1);
assert.doesNotMatch(reviewUi,/MonthlyNavigationStrip|className="review-pagination"/);
for(const page of [2,3]) {
 const next=new URLSearchParams(updateReviewQuery(active,{page:String(page)}));
 assert.equal(next.get("page"),String(page));
 for(const key of ["period","year","month","pageSize","type","search","doctorId","hospitalId","reviewStatus"]) assert.equal(next.get(key),new URLSearchParams(active).get(key));
}
for(const pageSize of ["25","50","100","all","25"]) {
 const next=new URLSearchParams(updateReviewQuery(active,{pageSize}));
 assert.equal(next.get("pageSize"),pageSize);assert.equal(next.get("page"),"1");
}
