export type CalendarMonth = { year: number; month: number };
export const arabicMonthNames = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"] as const;

const cairoDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
});

export function cairoBusinessDate(now = new Date()) {
  return cairoDateFormatter.format(now);
}

export function currentCairoMonth(now = new Date()): CalendarMonth {
  const [year, month] = cairoBusinessDate(now).split("-").map(Number);
  return { year, month };
}

export function isSupportedMonth({ year, month }: CalendarMonth) {
  return Number.isInteger(year) && year >= 2000 && year <= 2100 && Number.isInteger(month) && month >= 1 && month <= 12;
}

export function shiftCalendarMonth(value: CalendarMonth, delta: -1 | 1): CalendarMonth | null {
  const date = new Date(Date.UTC(value.year, value.month - 1 + delta, 1));
  const next = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
  return isSupportedMonth(value) && isSupportedMonth(next) ? next : null;
}

export type MonthlyPageSize = 25 | 50 | 100 | "all";

export function monthlyPageSize(value: string | null): MonthlyPageSize {
  return value === "all" ? "all" : value === "50" ? 50 : value === "100" ? 100 : 25;
}

// UI normalization only. API validation independently rejects unsafe all scopes.
export function normalizeMonthlyAll(query: URLSearchParams) {
  if (query.get("pageSize") === "all") {
    const explicitMonth = query.get("period") === "month" && isSupportedMonth({ year: Number(query.get("year")), month: Number(query.get("month")) }) && !["from", "to", "date", "limit", "offset"].some(key => query.has(key));
    if (!explicitMonth) query.set("pageSize", "25");
    query.set("page", "1");
  }
  return query.toString();
}

export function updateMonthlyQuery(current: string, changes: Record<string, string>) {
  const query = new URLSearchParams(current);
  for (const [key, value] of Object.entries(changes)) { if (value) query.set(key, value); else query.delete(key); }
  query.delete("limit"); query.delete("offset");
  if (!("page" in changes)) query.set("page", "1");
  return normalizeMonthlyAll(query);
}

// Review-specific defaults; transitions are shared with Operations.
export function canonicalReviewQuery(current: string, month: CalendarMonth) {
  const query = new URLSearchParams(current);
  if (!query.has("type")) query.set("type", "lithotripsy");
  const legacySize = Number(query.get("limit"));
  if (!query.has("pageSize")) query.set("pageSize", String([25, 50, 100].includes(legacySize) ? legacySize : 25));
  if (!query.has("page")) query.set("page", "1");
  query.delete("limit"); query.delete("offset");
  if (!["period", "year", "month", "from", "to", "date"].some(key => query.has(key))) {
    query.set("period", "month"); query.set("year", String(month.year)); query.set("month", String(month.month));
  }
  return normalizeMonthlyAll(query);
}

export function updateReviewQuery(current: string, changes: Record<string, string>) {
  return updateMonthlyQuery(current, changes);
}

export function monthlyScopeQuery(current: string, month: CalendarMonth) {
  return updateMonthlyQuery(current, { period: "month", year: String(month.year), month: String(month.month), from: "", to: "", date: "", pageSize: new URLSearchParams(current).get("pageSize") || "25" });
}

export const reviewMonthQuery = monthlyScopeQuery;

export function reviewCustomQuery(current: string, from: string, to: string) {
  return updateReviewQuery(current, { period: "custom", from, to, year: "", month: "", date: "" });
}

export function reviewPageCorrection(current: string, pagination: { page: number; totalPages: number; total: number }) {
  const requested = Number(new URLSearchParams(current).get("page") || 1);
  const target = pagination.total === 0 ? 1 : pagination.page > pagination.totalPages && pagination.totalPages >= 1 ? pagination.totalPages : pagination.page;
  return requested !== target ? updateReviewQuery(current, { page: String(target) }) : null;
}

// Bounded presentation window; independent of URL and server pagination.
export function pageNumberWindow(page: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages < 1) return [];
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const current = Math.max(1, Math.min(page, totalPages));
  const start = current <= 3 ? 1 : current >= totalPages - 2 ? totalPages - 3 : current - 2;
  const end = current <= 3 ? 4 : current >= totalPages - 2 ? totalPages : current + 2;
  const result: Array<number | "ellipsis"> = [];
  if (start > 1) { result.push(1); if (start > 2) result.push("ellipsis"); }
  for (let value = start; value <= end; value++) result.push(value);
  if (end < totalPages) { if (end < totalPages - 1) result.push("ellipsis"); result.push(totalPages); }
  return result;
}
