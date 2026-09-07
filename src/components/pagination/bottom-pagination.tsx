"use client";

import { monthlyPageSize, pageNumberWindow, type MonthlyPageSize } from "@/lib/pagination/monthly";

type Props = {
  page: number; pageSize: MonthlyPageSize; total: number; totalPages: number;
  hasNext: boolean; hasPrevious: boolean; monthlyScope: boolean; loading?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: MonthlyPageSize) => void;
};

export function BottomPagination({ page, pageSize, total, totalPages, hasNext, hasPrevious, monthlyScope, loading = false, onPageChange, onPageSizeChange }: Props) {
  const all = pageSize === "all";
  const current = all ? 1 : page;
  const pages = all ? [1] : pageNumberWindow(current, totalPages);
  return <nav className="bottom-pagination" aria-label="ترقيم الصفحات" dir="rtl">
    <div className="bottom-pagination-pages">
      <button type="button" aria-label="الصفحة السابقة" disabled={loading || all || !hasPrevious} onClick={() => onPageChange(current - 1)}>السابق</button>
      {pages.map((value, index) => typeof value === "number" ? <button key={value} type="button" aria-label={`الصفحة ${value}`} aria-current={value === current ? "page" : undefined} disabled={loading} onClick={() => onPageChange(value)}><bdi>{value}</bdi></button> : <span key={`gap-${index}`} aria-hidden="true">…</span>)}
      <button type="button" aria-label="الصفحة التالية" disabled={loading || all || !hasNext} onClick={() => onPageChange(current + 1)}>التالي</button>
    </div>
    <label>عرض: <select value={pageSize} onChange={event => onPageSizeChange(monthlyPageSize(event.target.value))}>
      {[25, 50, 100].map(size => <option key={size} value={size}>{size} حالة</option>)}
      <option value="all" disabled={!monthlyScope}>عرض كل حالات الشهر</option>
    </select></label>
    <small>الإجمالي: <bdi>{total}</bdi> حالة</small>
  </nav>;
}
