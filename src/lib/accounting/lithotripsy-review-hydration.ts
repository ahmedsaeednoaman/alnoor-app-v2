import type { ResolvedLithotripsyPrice, ReviewPricingOrigin } from "./lithotripsy-pricing";

export type HydratedLithotripsyFinancialLine = {
  kind: "financial";
  description: string;
  amount: string | null;
  baseAmount: string | null;
  adjustmentAmount: string | null;
  effectiveAmount: string | null;
  caseLineState: "included";
  financialEffect: "add" | "subtract" | "neutral";
  sourceType: string;
  sourceFieldId: string | null;
  sourceReferenceId: string | null;
  definitionId: string | null;
  pricingProfileId: string | null;
  pricingProfileLineId: string | null;
  pricingProfileVersion: number | null;
  pricingOrigin: ReviewPricingOrigin;
  notes: null;
};

function hydrationIdentity(price: ResolvedLithotripsyPrice) {
  if (price.source) return `source:${price.source.sourceType}:${price.source.sourceReferenceId ?? price.source.sourceId ?? ""}`;
  if (price.profileLineId) return `profile-line:${price.profileLineId}`;
  if (price.definitionId) return `definition:${price.definitionId}`;
  return `fixed:${price.stableKey}`;
}

export function hydrateNewLithotripsyFinancialDraft(prices: readonly ResolvedLithotripsyPrice[]) {
  const seen = new Set<string>();
  const result: HydratedLithotripsyFinancialLine[] = [];
  for (const price of prices) {
    const identity = hydrationIdentity(price);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const amount = price.defaultAmount == null ? null : String(price.defaultAmount);
    result.push({
      kind: "financial",
      description: price.label,
      amount,
      baseAmount: amount,
      adjustmentAmount: amount == null ? null : "0",
      effectiveAmount: amount,
      caseLineState: "included",
      financialEffect: price.effect,
      sourceType: price.source?.sourceType ?? "other",
      sourceFieldId: price.source?.sourceFieldId ?? null,
      sourceReferenceId: price.source?.sourceReferenceId ?? null,
      definitionId: price.source || price.profileLineId ? null : price.definitionId || null,
      pricingProfileId: price.profileId ?? null,
      pricingProfileLineId: price.profileLineId || null,
      pricingProfileVersion: price.profileVersion ?? null,
      pricingOrigin: price.pricingOrigin,
      notes: null,
    });
  }
  return result;
}

