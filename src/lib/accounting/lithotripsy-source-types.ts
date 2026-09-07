export function financialSourceDisplayLabel(categoryLabel: string, specificLabel?: string | null) {
  return `${categoryLabel} — ${specificLabel?.trim() || "افتراضي"}`;
}
