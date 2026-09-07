export type SourcePricingOrigin = "specific" | "generic" | "none";

export type SourcePricingLine = {
  lineType: string;
  sourceType: string | null;
  sourceReferenceId: string | null;
  defaultAmount: number | null;
};

export function resolveSourcePrice<T extends SourcePricingLine>({
  profileLines,
  sourceType,
  sourceReferenceId,
}: {
  profileLines: readonly T[];
  sourceType: string;
  sourceReferenceId: string | null;
}): { matchedLine: T | null; resolvedAmount: number | null; origin: SourcePricingOrigin } {
  const specific = sourceReferenceId == null ? undefined : profileLines.find((line) =>
    line.lineType === "linked_source" && line.sourceType === sourceType && line.sourceReferenceId === sourceReferenceId,
  );
  const generic = profileLines.find((line) =>
    line.lineType === "linked_role" && line.sourceType === sourceType && line.sourceReferenceId == null,
  );
  const matchedLine = specific ?? generic ?? null;
  return { matchedLine, resolvedAmount: matchedLine?.defaultAmount ?? null, origin: specific ? "specific" : generic ? "generic" : "none" };
}
