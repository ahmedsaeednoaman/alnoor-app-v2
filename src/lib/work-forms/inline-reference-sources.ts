// Shared workflow allowlist, not an authorization grant. The POST checks the
// caller's current operations.create permission independently.
const inlineReferenceCatalogs = {
  doctors: "doctors",
  hospitals: "hospitals",
  procedures: "procedures",
  equipment: "equipment",
  consumables: "consumables",
  stents: "stents",
  anesthesia_types: "anesthesia-types",
  anesthesiologists: "anesthesiologists",
  technicians: "technicians",
  contract_entities: "contract-entities",
} as const;

export type InlineReferenceSource = keyof typeof inlineReferenceCatalogs;

export function resolveInlineReferenceSource(source: string) {
  for (const [canonical, catalog] of Object.entries(inlineReferenceCatalogs)) {
    if (source === canonical || source === catalog) {
      return { source: canonical as InlineReferenceSource, catalog };
    }
  }
  return null;
}
