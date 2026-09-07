import { normalizeMonthlyAll, updateMonthlyQuery, monthlyScopeQuery, type CalendarMonth } from "../pagination/monthly";

export function updateOperationsQuery(current: string, changes: Record<string, string>) {
  return updateMonthlyQuery(current, changes);
}

// Navigation helpers change the URL only; the existing API remains authoritative.
export function canonicalOperationsQuery(current: string, month: CalendarMonth) {
  const query = new URLSearchParams(current);
  if (query.has("limit") || query.has("offset")) return query.toString();
  const hasDateScope = ["period", "year", "month", "from", "to", "date"].some(key => query.has(key));
  if (!hasDateScope) {
    query.set("period", "month"); query.set("year", String(month.year)); query.set("month", String(month.month));
  }
  if (!query.has("page")) query.set("page", "1");
  if (!query.has("pageSize")) query.set("pageSize", "25");
  return normalizeMonthlyAll(query);
}

export const operationsMonthQuery = monthlyScopeQuery;

export function operationsCustomRangeQuery(current: string, from: string, to: string) {
  return updateOperationsQuery(current, { period: "custom", from, to, year: "", month: "", date: "" });
}

export function operationsPageCorrection(current: string, pagination: { page: number; totalPages: number }) {
  const query = new URLSearchParams(current);
  if (query.has("limit") || query.has("offset")) return null;
  if (pagination.totalPages >= 1 && pagination.page > pagination.totalPages) {
    return updateOperationsQuery(current, { page: String(pagination.totalPages) });
  }
  return null;
}
