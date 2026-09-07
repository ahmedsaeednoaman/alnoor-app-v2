export type FinancialReviewGroupItem = {
  id: string;
  type: "lithotripsy" | "endoscopy" | "contract";
  operationDate: string;
  operationTime: string;
  dailySequence: number;
  doctorName?: string | null;
  doctorId?: string | null;
  hospitalName?: string | null;
  hospitalId?: string | null;
};

export type FinancialReviewGroup<T extends FinancialReviewGroupItem> = {
  key: string;
  label: string;
  firstTime: string;
  cases: T[];
};

export type FinancialReviewDay<T extends FinancialReviewGroupItem> = {
  date: string;
  casesCount: number;
  groups: FinancialReviewGroup<T>[];
};

const caseOrder = <T extends FinancialReviewGroupItem>(a: T, b: T) =>
  a.operationTime.localeCompare(b.operationTime) ||
  a.dailySequence - b.dailySequence ||
  a.id.localeCompare(b.id);

/** Presentation-only grouping. Financial values remain untouched and server-authored. */
export function groupFinancialReview<T extends FinancialReviewGroupItem>(
  rows: T[],
  type: FinancialReviewGroupItem["type"],
): FinancialReviewDay<T>[] {
  const days = new Map<string, T[]>();
  for (const row of rows) days.set(row.operationDate, [...(days.get(row.operationDate) ?? []), row]);

  return [...days.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, dayRows]) => {
      const groups = new Map<string, FinancialReviewGroup<T>>();
      for (const row of dayRows) {
        const label = type === "contract" ? row.hospitalName?.trim() : row.doctorName?.trim();
        const fallback = type === "contract" ? "بدون مستشفى محدد" : "بدون طبيب محدد";
        const sourceId = type === "contract" ? row.hospitalId : row.doctorId;
        const key = sourceId || label || fallback;
        const group = groups.get(key) ?? { key, label: label || fallback, firstTime: row.operationTime, cases: [] };
        group.cases.push(row);
        if (row.operationTime < group.firstTime) group.firstTime = row.operationTime;
        groups.set(key, group);
      }
      return {
        date,
        casesCount: dayRows.length,
        groups: [...groups.values()]
          .map((group) => ({ ...group, cases: group.cases.sort(caseOrder) }))
          .sort((a, b) => a.firstTime.localeCompare(b.firstTime) || a.label.localeCompare(b.label, "ar")),
      };
    });
}
