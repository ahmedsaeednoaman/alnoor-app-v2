export function parseSignedAdjustment(value: string | number | null | undefined): number | null {
  if (value == null || String(value).trim() === "") return null;
  const normalized = String(value).trim().replace(/^\+/, "");
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  return Number(normalized);
}

export function effectiveAmount(base: number | null, adjustment: number | null): number | null {
  if (base == null) return null;
  const result = base + (adjustment ?? 0);
  return result < 0 ? null : Math.round(result * 100) / 100;
}

export type SimpleReviewLine = {
  kind: "financial" | "note";
  amount: number | string | null;
  baseAmount?: number | string | null;
  adjustmentAmount?: number | string | null;
  effectiveAmount?: number | string | null;
  financialEffect: "add" | "subtract" | "neutral";
  caseLineState?: "included" | "excluded";
};

export function calculateSimpleReviewTotals(mainAmount: number, lines: SimpleReviewLine[]) {
  let additions = 0;
  let deductions = 0;
  for (const line of lines) {
    if (line.kind !== "financial" || line.caseLineState === "excluded") continue;
    const amount = Number(line.effectiveAmount ?? line.amount ?? 0);
    if (line.financialEffect === "add") additions += amount;
    if (line.financialEffect === "subtract") deductions += amount;
  }
  return {
    additionTotal: Math.round(additions * 100) / 100,
    deductionTotal: Math.round(deductions * 100) / 100,
    totalCosts: Math.round(deductions * 100) / 100,
    finalBalance: Math.round((mainAmount + additions - deductions) * 100) / 100,
  };
}

export type FinancialAccountingMode = "main_amount" | "direct_items";
export type DirectPaymentState = "unpaid" | "partial" | "paid";

export function calculateDoctorSettlementBalance(
  doctorDebtValue: number,
  prePostingPaymentValue: number | null,
) {
  const debt = Math.round(doctorDebtValue * 100) / 100;
  const paid = Math.max(0, Math.round((prePostingPaymentValue ?? 0) * 100) / 100);
  return Math.round((debt - paid) * 100) / 100;
}

/** @deprecated Use the signed settlement balance for new accounting flows. */
export const calculateDoctorPostingOutstanding = calculateDoctorSettlementBalance;

export function calculateDirectItemsDue(lines: SimpleReviewLine[]) {
  let total = 0;
  for (const line of lines) {
    if (line.kind !== "financial" || line.caseLineState === "excluded" || line.financialEffect === "neutral") continue;
    total += Number(line.effectiveAmount ?? line.amount ?? 0);
  }
  return Math.round(total * 100) / 100;
}

export function calculateDirectPaymentSummary(dueValue: number, receivedValue: number | null) {
  const due = Math.max(0, Math.round(dueValue * 100) / 100);
  const received = receivedValue == null ? null : Math.max(0, Math.round(receivedValue * 100) / 100);
  const effectiveReceived = received ?? 0;
  const remaining = calculateDoctorSettlementBalance(due, effectiveReceived);
  const state: DirectPaymentState = effectiveReceived <= 0 || due <= 0 ? "unpaid" : effectiveReceived < due ? "partial" : "paid";
  return { due, received, remaining, state };
}
