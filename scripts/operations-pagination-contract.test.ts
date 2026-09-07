import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  operationFilterSchema,
  operationPaginationMetadata,
  resolveOperationPagination,
} from "../src/lib/operations/validation";

import { currentCairoMonth, shiftCalendarMonth, pageNumberWindow } from "../src/lib/pagination/monthly";
import { canonicalOperationsQuery, operationsMonthQuery, operationsCustomRangeQuery, operationsPageCorrection, updateOperationsQuery } from "../src/lib/operations/list-query";

const fixedNow = new Date("2026-09-04T12:00:00Z");
const resolve = (input: unknown) => resolveOperationPagination(operationFilterSchema.parse(input), fixedNow);

assert.deepEqual(resolve({}), {
  period: "month", from: "2026-09-01", to: "2026-09-30", toExclusive: "2026-10-01",
  page: 1, pageSize: 25, offset: 0, legacyPaging: false,
});

for (const pageSize of [25, 50, 100]) assert.equal(resolve({ pageSize }).pageSize, pageSize);
for (const pageSize of [1, 24, 26, 101]) assert.equal(operationFilterSchema.safeParse({ pageSize }).success, false);

assert.deepEqual(resolve({ period: "month", year: 2026, month: 9 }).from, "2026-09-01");
assert.deepEqual(resolve({ period: "month", year: 2026, month: 9 }).toExclusive, "2026-10-01");
assert.deepEqual(resolve({ period: "month", year: 2026, month: 12 }).toExclusive, "2027-01-01");
assert.deepEqual(resolve({ period: "year", year: 2026 }), {
  period: "year", from: "2026-01-01", to: "2026-12-31", toExclusive: "2027-01-01",
  page: 1, pageSize: 25, offset: 0, legacyPaging: false,
});
assert.deepEqual(resolve({ period: "custom", from: "2026-09-01", to: "2026-09-30" }).toExclusive, "2026-10-01");
assert.deepEqual(resolve({ period: "week" }), {
  period: "week", from: "2026-08-29", to: "2026-09-04", toExclusive: "2026-09-05",
  page: 1, pageSize: 25, offset: 0, legacyPaging: false,
});

for (const invalid of [
  { period: "month", year: 2026 },
  { period: "month", year: 2026, month: 9, from: "2026-09-01" },
  { period: "year", year: 2026, month: 9 },
  { period: "custom", from: "2026-09-01" },
  { period: "custom", from: "2026-09-30", to: "2026-09-01" },
  { period: "week", year: 2026 },
  { period: "month", year: 2026, month: 9, date: "2026-09-01" },
  { page: 1, limit: 50 },
]) assert.equal(operationFilterSchema.safeParse(invalid).success, false, JSON.stringify(invalid));

const secondPage = resolve({ period: "year", year: 2026, page: 2, pageSize: 50 });
assert.equal(secondPage.offset, 50);
assert.deepEqual(operationPaginationMetadata(121, secondPage), {
  page: 2, pageSize: 50, total: 121, totalPages: 3, hasNext: true, hasPrevious: true,
});
assert.deepEqual(operationPaginationMetadata(10, resolve({ page: 4 })), {
  page: 4, pageSize: 25, total: 10, totalPages: 1, hasNext: false, hasPrevious: true,
});

const legacy = resolve({ limit: 40, offset: 80, from: "2026-08-01", to: "2026-08-31" });
assert.equal(legacy.page, 3);
assert.equal(legacy.pageSize, 40);
assert.equal(legacy.offset, 80);
assert.equal(legacy.legacyPaging, true);
assert.deepEqual(resolve({ limit: 100, offset: 0 }), {
  period: null, from: null, to: null, toExclusive: null,
  page: 1, pageSize: 100, offset: 0, legacyPaging: true,
});

const preserved = operationFilterSchema.parse({ type: "endoscopy", doctorId: "11111111-1111-4111-8111-111111111111", hospitalId: "22222222-2222-4222-8222-222222222222", search: "case", date: "2026-09-04" });
assert.equal(preserved.type, "endoscopy");
assert.equal(preserved.search, "case");

const service = readFileSync("src/lib/operations/service.ts", "utf8");
assert.match(service, /SELECT count\(\*\)::text total \$\{fromSql\}/, "total uses a dedicated COUNT query");
assert.match(service, /const fromSql =[\s\S]+\$\{conditions\.join\(" AND "\)\}/, "count and rows share one predicate");
assert.match(service, /created_by_user_id = \?::uuid[\s\S]+current_date - 6/, "Employee ownership and seven-day ceiling remain enforced");
assert.match(readFileSync("src/lib/operations/tax-invoice.ts", "utf8"), /operation_date DESC, o\.daily_sequence DESC, o\.id DESC/, "ordering is deterministic");
assert.match(service, /o\.type = \?::operation_type/, "type filter remains");
assert.match(service, /o\.doctor_id = \?::uuid/, "doctor filter remains");
assert.match(service, /o\.hospital_id = \?::uuid/, "hospital filter remains");
assert.match(service, /o\.case_name ILIKE/, "search filter remains");

// Cairo has crossed into September while UTC is still in August.
const cairoBoundary = new Date("2026-08-31T22:30:00Z");
assert.deepEqual(currentCairoMonth(cairoBoundary), { year: 2026, month: 9 });
assert.equal(resolveOperationPagination(operationFilterSchema.parse({}), cairoBoundary).from, "2026-09-01");
assert.deepEqual(shiftCalendarMonth({year:2026,month:1}, -1), {year:2025,month:12});
assert.deepEqual(shiftCalendarMonth({year:2026,month:12}, 1), {year:2027,month:1});
assert.equal(shiftCalendarMonth({year:2000,month:1}, -1), null);
assert.equal(shiftCalendarMonth({year:2100,month:12}, 1), null);
const defaultMonth = currentCairoMonth(fixedNow);
assert.equal(canonicalOperationsQuery("", defaultMonth), "period=month&year=2026&month=9&page=1&pageSize=25");
const canonical = canonicalOperationsQuery("search=case&page=2&pageSize=50", defaultMonth);
assert.equal(canonicalOperationsQuery(canonical, defaultMonth), canonical, "normalization is idempotent");
assert.equal(new URLSearchParams(canonical).get("page"), "2");
assert.equal(new URLSearchParams(canonical).get("search"), "case");
assert.equal(canonicalOperationsQuery("limit=40&offset=80", defaultMonth), "limit=40&offset=80", "legacy API links retain compatibility");
const activeQuery = new URLSearchParams({period:"month",year:"2026",month:"9",page:"7",pageSize:"50",type:"contract",search:"أحمد",doctorId:"11111111-1111-4111-8111-111111111111",hospitalId:"22222222-2222-4222-8222-222222222222",invoiceStatus:"pending"}).toString();
for (const nextMonth of [{year:2026,month:10},{year:2027,month:9}]) {
  const next = new URLSearchParams(operationsMonthQuery(activeQuery,nextMonth));
  assert.equal(next.get("page"),"1");
  assert.equal(next.get("year"),String(nextMonth.year));
  assert.equal(next.get("month"),String(nextMonth.month));
  for(const key of ["type","search","doctorId","hospitalId","invoiceStatus","pageSize"]) assert.equal(next.get(key),new URLSearchParams(activeQuery).get(key));
  assert.equal(operationFilterSchema.safeParse(Object.fromEntries(next)).success,true);
  assert.equal(next.has("limit"),false);assert.equal(next.has("offset"),false);
}
const custom = operationsCustomRangeQuery(activeQuery,"2026-08-10","2026-09-11");
const customParams=new URLSearchParams(custom);
assert.equal(customParams.get("period"),"custom");assert.equal(customParams.get("page"),"1");
for(const key of ["year","month","date"])assert.equal(customParams.has(key),false);
assert.equal(operationFilterSchema.safeParse(Object.fromEntries(customParams)).success,true);
const monthlyAgain=new URLSearchParams(operationsMonthQuery(custom,{year:2026,month:9}));
for(const key of ["from","to","date","limit","offset"])assert.equal(monthlyAgain.has(key),false);
assert.equal(monthlyAgain.get("invoiceStatus"),"pending");
assert.equal(new URLSearchParams(operationsMonthQuery("limit=100&offset=100",defaultMonth)).get("pageSize"),"25");
for(const key of ["type","search","doctorId","hospitalId","invoiceStatus","pageSize"]) {
 const next=new URLSearchParams(updateOperationsQuery(activeQuery,{[key]:key==="pageSize"?"100":"changed"}));
 assert.equal(next.get("page"),"1");assert.equal(next.get("year"),"2026");assert.equal(next.get("month"),"9");
}
const corrected=operationsPageCorrection(activeQuery,{page:7,totalPages:2})!;
assert.equal(new URLSearchParams(corrected).get("page"),"2");
assert.equal(new URLSearchParams(corrected).get("invoiceStatus"),"pending");
assert.equal(operationsPageCorrection(corrected,{page:2,totalPages:2}),null,"correction terminates");
assert.equal(operationsPageCorrection(activeQuery,{page:7,totalPages:0}),null);
assert.equal(operationsPageCorrection(activeQuery,{page:1,totalPages:2}),null);
const pageSource=readFileSync("src/app/(shell)/operations/page.tsx","utf8");
assert.ok(pageSource.indexOf("if (canonical !==")<pageSource.indexOf("return <OperationsList"),"canonical redirect precedes list mount");
console.log("Operations pagination and monthly navigation contract: PASS");

// Explicit month-only all mode and shared URL transition contracts.
const allInput = { period: "month", year: 2026, month: 9, pageSize: "all", page: 8 };
assert.equal(resolve(allInput).page, 1);
assert.equal(resolve(allInput).offset, 0);
assert.equal(resolve(allInput).pageSize, "all");
for (const scope of [{}, { period: "year", year: 2026 }, { period: "week" }, { period: "custom", from: "2020-01-01", to: "2026-09-01" }, { date: "2026-09-01" }, { limit: 100 }, { ...allInput, offset: 0 }, { period: "month", year: 2026 }, { ...allInput, from: "2026-09-01" }]) {
  assert.equal(operationFilterSchema.safeParse({ ...scope, pageSize: "all" }).success, false);
}
const allQuery = updateOperationsQuery(activeQuery, { pageSize: "all" });
assert.equal(new URLSearchParams(allQuery).get("page"), "1");
assert.equal(new URLSearchParams(updateOperationsQuery(allQuery, { page: "8" })).get("page"), "1");
for (const year of [2025, 2027]) {
  const q = new URLSearchParams(operationsMonthQuery(allQuery, { year, month: 9 }));
  assert.equal(q.get("year"), String(year)); assert.equal(q.get("month"), "9");
  assert.equal(q.get("page"), "1"); assert.equal(q.get("pageSize"), "all");
  for (const key of ["type", "doctorId", "hospitalId", "search", "invoiceStatus", "reviewStatus"]) assert.equal(q.get(key), new URLSearchParams(allQuery).get(key));
  assert.equal(q.has("limit"), false); assert.equal(q.has("offset"), false);
}
const safeCustom = operationsCustomRangeQuery(allQuery, "2026-08-01", "2026-09-30");
assert.equal(new URLSearchParams(safeCustom).get("pageSize"), "25");
assert.equal(new URLSearchParams(operationsMonthQuery(safeCustom, { year: 2026, month: 9 })).get("pageSize"), "25");

for (const total of [0, 59]) assert.deepEqual(operationPaginationMetadata(total, resolve(allInput)), { page: 1, pageSize: "all", total, totalPages: total ? 1 : 0, hasNext: false, hasPrevious: false });
assert.equal(new URLSearchParams(canonicalOperationsQuery("period=month&year=2026&month=9&page=8&pageSize=all", defaultMonth)).get("page"), "1");

async function allSqlContract() {
  const { postgresClient } = await import("../src/db/client");
  const { listOperations } = await import("../src/lib/operations/service");
  const { invoicePredicate } = await import("../src/lib/operations/tax-invoice");
  const original = postgresClient.unsafe;
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const fixtures = Array.from({ length: 59 }, (_, id) => ({ id: String(id), caseName: "case", taxInvoice: null }));
  postgresClient.unsafe = (async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    return sql.startsWith("SELECT count") ? [{ total: String(fixtures.length) }] : fixtures;
  }) as unknown as typeof original;
  const user = { id: "11111111-1111-4111-8111-111111111111", role: { code: "employee" }, permissions: ["operations.view"] };
  try {
    for (const invoiceStatus of ["pending", "completed", "latest"] as const) {
      calls.length = 0;
      const result = await listOperations(operationFilterSchema.parse({ ...allInput, invoiceStatus, type: "contract", doctorId: user.id, hospitalId: user.id, search: "case" }), user);
      assert.deepEqual(result.operations, fixtures, "row DTO is not transformed");
      assert.deepEqual(result.pagination, { page: 1, pageSize: "all", total: 59, totalPages: 1, hasNext: false, hasPrevious: false });
      const [count, rows] = calls;
      assert.doesNotMatch(rows.sql, /LIMIT|OFFSET/);
      assert.ok(rows.sql.includes(count.sql.slice(count.sql.indexOf("FROM operations"))));
      assert.match(count.sql, /o.operation_date >= \$1::date AND o.operation_date < \$2::date/);
      assert.deepEqual(count.values.slice(0, 2), ["2026-09-01", "2026-10-01"]);
      assert.match(count.sql, /created_by_user_id = [\s\S]*current_date - 6/);
      assert.ok(count.sql.includes(invoicePredicate(invoiceStatus)));
      assert.match(count.sql, /o.type = [\s\S]*o.doctor_id = [\s\S]*o.hospital_id = [\s\S]*o.case_name ILIKE/);
      assert.deepEqual(rows.values, [...count.values, user.id]);
    }
  } finally { postgresClient.unsafe = original; await postgresClient.end(); }
  console.log("Operations month-only all SQL contract: PASS (recording boundary)");
}
void allSqlContract();

const requestAll = updateOperationsQuery("period=month&year=2026&month=9&page=8&pageSize=25", { pageSize: "all" });
assert.equal(`/api/v1/operations?${requestAll}`, "/api/v1/operations?period=month&year=2026&month=9&page=1&pageSize=all");
const compact = readFileSync("src/components/pagination/compact-month-filter.tsx", "utf8");
const bottom = readFileSync("src/components/pagination/bottom-pagination.tsx", "utf8");
assert.doesNotMatch(compact + bottom, /fetch\(|useState|window\./);
assert.match(compact, /<select aria-label="الشهر"/);
assert.match(bottom, /aria-current=/);
for (const [page, total, expected] of [
  [1, 1, [1]], [2, 4, [1,2,3,4]], [1, 20, [1,2,3,4,"ellipsis",20]],
  [10, 20, [1,"ellipsis",8,9,10,11,12,"ellipsis",20]], [20,20,[1,"ellipsis",17,18,19,20]],
] as const) assert.deepEqual(pageNumberWindow(page,total),expected);
assert.deepEqual(pageNumberWindow(1,0),[]);
for(let page=1;page<=100;page++) {
 const values=pageNumberWindow(page,100);
 assert.ok(values.length<=9);assert.ok(values.includes(page));
 assert.equal(values.some((value,index)=>value==="ellipsis"&&values[index+1]==="ellipsis"),false);
}
const operationsUi = readFileSync("src/components/operations/operations-list.tsx", "utf8");
assert.match(operationsUi, /fetch\(`\/api\/v1\/operations\?\$\{queryString\}`/);
assert.match(operationsUi, /\[load\]/);
assert.match(readFileSync("src/app/api/v1/operations/route.ts", "utf8"), /requirePermission\("operations.view"\)/);

assert.equal((operationsUi.match(/<BottomPagination /g)||[]).length,1);
assert.equal((operationsUi.match(/<CompactMonthFilter /g)||[]).length,1);
assert.doesNotMatch(operationsUi,/MonthlyNavigationStrip|className="operations-pagination"/);
for(const page of [2,3]) {
 const next=new URLSearchParams(updateOperationsQuery(activeQuery,{page:String(page)}));
 assert.equal(next.get("page"),String(page));
 for(const key of ["period","year","month","pageSize","type","search","doctorId","hospitalId","invoiceStatus"]) assert.equal(next.get(key),new URLSearchParams(activeQuery).get(key));
}
for(const pageSize of ["25","50","100","all","25"]) {
 const next=new URLSearchParams(updateOperationsQuery(activeQuery,{pageSize}));
 assert.equal(next.get("pageSize"),pageSize);assert.equal(next.get("page"),"1");
}
