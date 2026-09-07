export type CalculationItem = { kind: string; financialEffect: string; amount: number | string | null; effectiveAmount?: number | string | null; caseLineState?: "included" | "excluded" };
const cents = (value: number | string | null | undefined) => Math.round(Number(value ?? 0) * 100);
export function calculateFinancialSummary(mainAmount: number | string, items: CalculationItem[]) {
  let addition = 0;
  let deduction = 0;
  for (const item of items) {
    if (item.kind !== "financial" || item.caseLineState === "excluded") continue;
    const amount = item.effectiveAmount ?? item.amount;
    if (item.financialEffect === "add") addition += cents(amount);
    if (item.financialEffect === "subtract") deduction += cents(amount);
  }
  const main = cents(mainAmount);
  return { mainAmount: main / 100, additionTotal: addition / 100, deductionTotal: deduction / 100, finalBalance: (main + addition - deduction) / 100 };
}
