"use client";

import { arabicMonthNames, shiftCalendarMonth, type CalendarMonth } from "@/lib/pagination/monthly";

type Props = CalendarMonth & { monthlyScope: boolean; onMonthChange: (value: CalendarMonth) => void };

export function CompactMonthFilter({ year, month, monthlyScope, onMonthChange }: Props) {
  const previous = shiftCalendarMonth({ year, month }, -1);
  const next = shiftCalendarMonth({ year, month }, 1);
  return <div className="compact-month-filter" role="group" aria-label="الشهر والسنة" dir="rtl">
    <button type="button" aria-label="الشهر السابق" disabled={!previous} onClick={() => previous && onMonthChange(previous)}>‹</button>
    <select aria-label="الشهر" value={monthlyScope ? month : ""} onChange={event => onMonthChange({ year, month: Number(event.target.value) })}>
      {!monthlyScope && <option value="" disabled>فترة مخصصة</option>}
      {arabicMonthNames.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
    </select>
    <input aria-label="السنة" key={year} type="number" inputMode="numeric" min={2000} max={2100} step={1} required defaultValue={year} onBlur={event => {
      if (event.currentTarget.reportValidity()) {
        const nextYear = event.currentTarget.valueAsNumber;
        if (nextYear !== year || !monthlyScope) onMonthChange({ year: nextYear, month });
      }
    }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}/>
    <button type="button" aria-label="الشهر التالي" disabled={!next} onClick={() => next && onMonthChange(next)}>›</button>
  </div>;
}
