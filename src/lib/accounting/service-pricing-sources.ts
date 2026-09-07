import { postgresClient } from "@/db/client";
import { OperationDomainError } from "@/lib/operations/api";
import { getPublishedTemplate } from "@/lib/work-forms/service";
import { resolveSmartDropdownSource } from "@/lib/work-forms/registry";
import type { SmartDropdownSource } from "@/lib/work-forms/types";
import type { ServicePricingDomain } from "./service-pricing";

type Executor = Pick<typeof postgresClient, "unsafe">;
type PublishedField = {
  stableKey: string;
  label: string;
  smartDropdownSource: SmartDropdownSource | null;
  reviewRole?: string;
  archivedAt?: string | null;
};

export type ServicePricingSourceCategory = {
  sourceType: "procedure" | "equipment" | "consumable";
  name: string;
  catalogSource: SmartDropdownSource;
};

const sourceType = (stableKey: string): ServicePricingSourceCategory["sourceType"] | null =>
  stableKey === "procedures" ? "procedure" : stableKey === "equipment" ? "equipment" : stableKey === "consumables" ? "consumable" : null;

export async function listServicePricingSources(type: ServicePricingDomain): Promise<ServicePricingSourceCategory[]> {
  const template = await getPublishedTemplate(type);
  const fields = template.sections.flatMap((section) => section.fields) as PublishedField[];
  return fields.flatMap((field) => {
    const mapped = sourceType(field.stableKey);
    if (!mapped || !field.smartDropdownSource || field.archivedAt || (field.stableKey !== "procedures" && field.reviewRole !== "cost_source")) return [];
    return [{ sourceType: mapped, name: field.label, catalogSource: field.smartDropdownSource }];
  });
}

export async function listServicePricingCatalog(type: ServicePricingDomain, requestedSource: string, db: Executor = postgresClient) {
  const category = (await listServicePricingSources(type)).find((source) => source.catalogSource === requestedSource);
  if (!category) throw new OperationDomainError(400, "SERVICE_PRICING_SOURCE_INVALID", "مصدر البند غير متاح في نموذج العمليات الحالي.");
  const definition = resolveSmartDropdownSource(category.catalogSource);
  return db.unsafe<Array<{ id: string; name: string }>>(
    `select id,${definition.labelColumn} name from "${definition.table}" where ${definition.active} order by ${definition.labelColumn} limit 100`,
  );
}

export async function resolveServicePricingCatalogItem(type: ServicePricingDomain, requestedSourceType: string, referenceId: string, db: Executor = postgresClient) {
  const category = (await listServicePricingSources(type)).find((source) => source.sourceType === requestedSourceType);
  if (!category) throw new OperationDomainError(400, "SERVICE_PRICING_SOURCE_INVALID", "مصدر البند غير متاح في نموذج العمليات الحالي.");
  const definition = resolveSmartDropdownSource(category.catalogSource);
  const [row] = await db.unsafe<Array<{ id: string; name: string }>>(
    `select id,${definition.labelColumn} name from "${definition.table}" where id=$1::uuid and ${definition.active}`,
    [referenceId],
  );
  if (!row) throw new OperationDomainError(400, "SERVICE_PRICING_REFERENCE_INVALID", "العنصر المختار غير موجود أو مؤرشف.");
  return { ...category, id: row.id, itemName: row.name, label: `${category.name} — ${row.name}` };
}
