import { postgresClient } from "@/db/client";
import { OperationDomainError } from "@/lib/operations/api";
import { getOperationFinancialSources, type FinancialSource } from "./sources";
import { listServicePricingSources, resolveServicePricingCatalogItem } from "./service-pricing-sources";

type Executor = Pick<typeof postgresClient, "unsafe">;
type Row = Record<string, unknown>;
export type ServicePricingDomain = "contract" | "endoscopy";
export type ServicePricingItem = {
  id: string; stableKey: string; sourceType: string; sourceReferenceId: string | null;
  label: string; defaultAmount: number | null; effect: "add" | "subtract" | "neutral";
  sortOrder: number; active: boolean; notes: string | null;
};
export type ServicePricingProfile = {
  id: string; operationType: ServicePricingDomain; hospitalId: string | null; hospitalName: string | null;
  name: string; version: number; active: boolean; notes: string | null; items: ServicePricingItem[];
};

const item = (row: Row): ServicePricingItem => ({
  id: String(row.id), stableKey: String(row.stable_key), sourceType: String(row.source_type),
  sourceReferenceId: row.source_reference_id == null ? null : String(row.source_reference_id),
  label: String(row.label), defaultAmount: row.default_amount == null ? null : Number(row.default_amount),
  effect: row.effect as ServicePricingItem["effect"], sortOrder: Number(row.sort_order),
  active: Boolean(row.active), notes: row.notes == null ? null : String(row.notes),
});
const normalizeMoney = (value: unknown) => {
  if (value == null || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new OperationDomainError(400, "SERVICE_PRICE_INVALID", "السعر غير صالح.");
  return amount.toFixed(2);
};
const permissionFor = (type: ServicePricingDomain) => `accounting.${type}.pricing.manage`;
export { permissionFor as servicePricingPermission };

export async function listServicePricing(type: ServicePricingDomain, includeArchived = true, db: Executor = postgresClient) {
  const profiles = await db.unsafe<Row[]>(`select p.*,h.name hospital_name from service_pricing_profiles p left join hospitals h on h.id=p.hospital_id where p.operation_type=$1::operation_type ${includeArchived ? "" : "and p.active=true"} order by p.active desc,h.name,p.created_at`, [type]);
  const ids = profiles.map((profile) => String(profile.id));
  const lines = ids.length ? await db.unsafe<Row[]>("select * from service_pricing_items where profile_id=any($1::uuid[]) order by active desc,sort_order,id", [ids]) : [];
  return profiles.map((profile): ServicePricingProfile => ({
    id: String(profile.id), operationType: type, hospitalId: profile.hospital_id == null ? null : String(profile.hospital_id),
    hospitalName: profile.hospital_name == null ? null : String(profile.hospital_name), name: String(profile.name),
    version: Number(profile.version), active: Boolean(profile.active), notes: profile.notes == null ? null : String(profile.notes),
    items: lines.filter((line) => String(line.profile_id) === String(profile.id)).map(item),
  }));
}

export async function createServicePricingProfile(type: ServicePricingDomain, input: Row, userId: string) {
  const name = String(input.name ?? "").trim();
  const hospitalId = type === "contract" ? String(input.hospitalId ?? "") : null;
  if (name.length < 2 || (type === "contract" && !hospitalId)) throw new OperationDomainError(400, "SERVICE_PROFILE_INVALID", "اسم القائمة والمستشفى مطلوبان.");
  try {
    await postgresClient.unsafe(`insert into service_pricing_profiles(operation_type,hospital_id,name,created_by_user_id,updated_by_user_id) values($1::operation_type,$2::uuid,$3,$4::uuid,$4::uuid)`, [type, hospitalId, name, userId]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new OperationDomainError(409, "SERVICE_PROFILE_DUPLICATE", type === "contract" ? "توجد قائمة أسعار نشطة لهذا المستشفى." : "توجد قائمة أسعار عامة نشطة للمناظير.");
    throw error;
  }
  return listServicePricing(type);
}

export async function mutateServicePricing(type: ServicePricingDomain, input: Row, userId: string) {
  const action = String(input.action ?? "");
  return postgresClient.begin(async (tx) => {
    if (action === "add_item") {
      const profileId = String(input.profileId ?? ""), sourceType = String(input.sourceType ?? "manual");
      const reference = input.sourceReferenceId ? String(input.sourceReferenceId) : null;
      const catalogItem = reference ? await resolveServicePricingCatalogItem(type, sourceType, reference, tx) : null;
      const isFixed = sourceType === "manual" || sourceType === "other";
      const genericCategory = !reference && !isFixed ? (await listServicePricingSources(type)).find((source) => source.sourceType === sourceType) : null;
      if (!reference && !isFixed && !genericCategory) throw new OperationDomainError(400, "SERVICE_PRICING_SOURCE_INVALID", "مصدر البند غير متاح في نموذج العمليات الحالي.");
      const label = catalogItem?.label ?? (genericCategory ? `${genericCategory.name} — افتراضي للفئة` : String(input.label ?? "").trim());
      const stableKey = catalogItem ? `${sourceType}:${reference}` : isFixed ? `fixed:${crypto.randomUUID()}` : `category:${sourceType}`;
      if (!profileId || label.length < 2) throw new OperationDomainError(400, "SERVICE_ITEM_INVALID", "اسم البند ومصدره مطلوبان.");
      const profiles = await tx.unsafe<Row[]>("select id from service_pricing_profiles where id=$1::uuid and operation_type=$2::operation_type", [profileId, type]);
      if (!profiles[0]) throw new OperationDomainError(404, "SERVICE_PROFILE_NOT_FOUND", "قائمة الأسعار المطلوبة غير موجودة في هذا القسم.");
      await tx.unsafe(`insert into service_pricing_items(profile_id,stable_key,source_type,source_reference_id,label,default_amount,effect,sort_order,created_by_user_id,updated_by_user_id) select $1::uuid,$2,$3::financial_item_source_type,$4::uuid,$5,$6::numeric,$7::work_form_financial_effect,coalesce(max(sort_order),-1)+1,$8::uuid,$8::uuid from service_pricing_items where profile_id=$1::uuid`, [profileId, stableKey, sourceType, reference, label, normalizeMoney(input.defaultAmount), String(input.effect ?? "subtract"), userId]);
      await tx.unsafe("update service_pricing_profiles set version=version+1,updated_by_user_id=$2::uuid,updated_at=now() where id=$1::uuid and operation_type=$3::operation_type", [profileId, userId, type]);
    } else if (action === "update_item") {
      await tx.unsafe(`update service_pricing_items i set label=$3,default_amount=$4::numeric,effect=$5::work_form_financial_effect,notes=$6,updated_by_user_id=$7::uuid,updated_at=now() from service_pricing_profiles p where i.profile_id=p.id and i.id=$1::uuid and p.operation_type=$2::operation_type`, [String(input.itemId), type, String(input.label ?? "").trim(), normalizeMoney(input.defaultAmount), String(input.effect ?? "subtract"), input.notes == null ? null : String(input.notes), userId]);
      await tx.unsafe("update service_pricing_profiles p set version=version+1,updated_by_user_id=$2::uuid,updated_at=now() from service_pricing_items i where i.profile_id=p.id and i.id=$1::uuid", [String(input.itemId), userId]);
    } else if (action === "archive_item" || action === "restore_item") {
      const active = action === "restore_item";
      await tx.unsafe(`update service_pricing_items i set active=$3,archived_at=case when $3 then null else now() end,updated_by_user_id=$4::uuid,updated_at=now() from service_pricing_profiles p where i.profile_id=p.id and i.id=$1::uuid and p.operation_type=$2::operation_type`, [String(input.itemId), type, active, userId]);
    } else if (action === "archive_profile" || action === "restore_profile") {
      const active = action === "restore_profile";
      await tx.unsafe("update service_pricing_profiles set active=$3,archived_at=case when $3 then null else now() end,updated_by_user_id=$4::uuid,updated_at=now() where id=$1::uuid and operation_type=$2::operation_type", [String(input.profileId), type, active, userId]);
    } else throw new OperationDomainError(400, "SERVICE_PRICING_ACTION_INVALID", "إجراء التسعير غير صالح.");
    return listServicePricing(type, true, tx);
  });
}

export type ResolvedServicePrice = { source: FinancialSource | null; servicePricingProfileId: string; servicePricingItemId: string | null; servicePricingVersion: number; label: string; defaultAmount: number | null; effect: ServicePricingItem["effect"]; pricingOrigin: "specific_source_default" | "category_default" | "fixed_profile_item" | "none" };
export async function resolveServicePricing(operationId: string, db: Executor = postgresClient) {
  const [operation] = await db.unsafe<Row[]>("select type,hospital_id from operations where id=$1::uuid", [operationId]);
  if (!operation || !["contract", "endoscopy"].includes(String(operation.type))) return { profile: null, prices: [] as ResolvedServicePrice[], warning: null };
  const type = String(operation.type) as ServicePricingDomain;
  const profiles = await db.unsafe<Row[]>(`select * from service_pricing_profiles where operation_type=$1::operation_type and active=true and (($1='contract' and hospital_id=$2::uuid) or ($1='endoscopy' and hospital_id is null)) limit 1`, [type, operation.hospital_id == null ? null : String(operation.hospital_id)]);
  const profile = profiles[0];
  const sourceProjection = await getOperationFinancialSources(operationId, db);
  const sources = [...sourceProjection.costSources];
  const procedureRows = await db.unsafe<Array<{ id:string; name:string; fieldId:string|null }>>(`select p.id,p.name,(select f.id from work_form_fields f where f.template_id=o.form_template_id and f.stable_key='procedures' and f.archived_at is null limit 1) "fieldId" from operations o join operation_procedures op on op.operation_id=o.id join procedures p on p.id=op.procedure_id where o.id=$1::uuid order by p.name`, [operationId]);
  for (const procedure of procedureRows) if (!sources.some((source) => source.sourceType === "procedure" && source.sourceReferenceId === procedure.id)) sources.push({ sourceType:"procedure",sourceId:procedure.id,sourceFieldId:procedure.fieldId,sourceReferenceId:procedure.id,label:procedure.name,contextLabel:"الإجراء",defaultEffect:"subtract" });
  if (!profile) return { profile: null, prices: sources.map((source) => ({ source, servicePricingProfileId: "", servicePricingItemId: null, servicePricingVersion: 0, label: `${source.contextLabel} — ${source.label}`, defaultAmount: null, effect: source.defaultEffect, pricingOrigin: "none" as const })), warning: type === "contract" ? "لا توجد قائمة أسعار تعاقد نشطة لهذا المستشفى." : "لا توجد قائمة أسعار عامة نشطة للمناظير." };
  const lines = (await db.unsafe<Row[]>("select * from service_pricing_items where profile_id=$1::uuid and active=true order by sort_order,id", [String(profile.id)])).map(item);
  const prices: ResolvedServicePrice[] = sources.map((source) => {
    const exact = lines.find((line) => line.sourceType === source.sourceType && line.sourceReferenceId === source.sourceReferenceId);
    const generic = lines.find((line) => line.sourceType === source.sourceType && line.sourceReferenceId == null && !line.stableKey.startsWith("fixed:"));
    const matched = exact ?? generic;
    return { source, servicePricingProfileId: String(profile.id), servicePricingItemId: matched?.id ?? null, servicePricingVersion: Number(profile.version), label: `${source.contextLabel} — ${source.label}`, defaultAmount: matched?.defaultAmount ?? null, effect: matched?.effect ?? source.defaultEffect, pricingOrigin: exact ? "specific_source_default" : generic ? "category_default" : "none" };
  });
  for (const fixed of lines.filter((line) => line.sourceReferenceId == null && (line.sourceType === "manual" || line.sourceType === "other" || line.stableKey.startsWith("fixed:")))) prices.push({ source: null, servicePricingProfileId: String(profile.id), servicePricingItemId: fixed.id, servicePricingVersion: Number(profile.version), label: fixed.label, defaultAmount: fixed.defaultAmount, effect: fixed.effect, pricingOrigin: "fixed_profile_item" });
  return { profile: { id: String(profile.id), name: String(profile.name), version: Number(profile.version), hospitalId: profile.hospital_id == null ? null : String(profile.hospital_id) }, prices, warning: null };
}
