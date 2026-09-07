import { postgresClient } from "@/db/client";
import { OperationDomainError } from "@/lib/operations/api";
import { getOperationFinancialSources, type FinancialSource } from "./sources";
import { resolveLithotripsyPricingProfile, type ProfileMatchType } from "./lithotripsy-profiles";
import { resolveSourcePrice, type SourcePricingOrigin } from "./lithotripsy-source-pricing";

type Executor = Pick<typeof postgresClient, "unsafe">;
type Row = Record<string, unknown>;
export type LithotripsyPricingDefinition = {
  id: string; stableKey: string; label: string; category: string;
  sourceType: string | null; sourceReferenceId: string | null; sessionValue: number | null;
  defaultAmount: number | null; effect: "add" | "subtract" | "neutral"; sortOrder: number; active: boolean;
};
const seed = [
  ["anesthesiologist_default", "طبيب التخدير", "linked_operational_source", "anesthesiologist", null, null, 450],
  ["technician_default", "الفني", "linked_operational_source", "technician", null, null, 400],
  ["session_expenses_first", "مصاريف الجلسة الأولى", "session_dependent", null, 1, null, 500],
  ["session_expenses_second", "مصاريف الجلسة الثانية", "session_dependent", null, 2, null, 300],
  ["nursing_workers", "تمريض وعمال", "fixed_accountant_line", null, null, null, 200],
] as const;
const map = (r: Row): LithotripsyPricingDefinition => ({
  id: String(r.id), stableKey: String(r.stable_key), label: String(r.label), category: String(r.category),
  sourceType: r.source_type == null ? null : String(r.source_type), sourceReferenceId: r.source_reference_id == null ? null : String(r.source_reference_id),
  sessionValue: r.session_value == null ? null : Number(r.session_value), defaultAmount: r.default_amount == null ? null : Number(r.default_amount),
  effect: r.effect as LithotripsyPricingDefinition["effect"], sortOrder: Number(r.sort_order), active: Boolean(r.active),
});
export async function ensureLithotripsyPricing(userId: string, db: Executor = postgresClient) {
  for (const [stableKey, label, category, sourceType, sessionValue, sourceReferenceId, amount] of seed) {
    await db.unsafe(`insert into lithotripsy_pricing_definitions(stable_key,label,category,source_type,source_reference_id,session_value,default_amount,effect,sort_order,active,created_by_user_id,updated_at)
      values($1,$2,$3,$4,$5::uuid,$6,$7,'subtract',$8,true,$9::uuid,now()) on conflict (stable_key) do nothing`,
      [stableKey, label, category, sourceType, sourceReferenceId, sessionValue, amount, seed.findIndex((item) => item[0] === stableKey), userId]);
  }
  return listLithotripsyPricing(db);
}
export async function listLithotripsyPricing(db: Executor = postgresClient) {
  const rows = await db.unsafe<Row[]>("select * from lithotripsy_pricing_definitions where active=true order by sort_order,id");
  return rows.map(map);
}
export async function mutateLithotripsyPricing(action: string, input: Row, userId: string) {
  return postgresClient.begin(async (tx) => {
    if (action === "add") {
      const label = String(input.label ?? "").trim().replace(/\s+/gu, " ");
      const amount = input.defaultAmount == null || input.defaultAmount === "" ? null : Number(input.defaultAmount);
      if (label.length < 2 || (amount != null && (!Number.isFinite(amount) || amount < 0))) throw new OperationDomainError(400, "LITHO_PRICING_INVALID", "اسم البند والسعر الافتراضي مطلوبان بشكل صحيح.");
      const stableKey = String(input.stableKey ?? `custom_${Date.now()}`).replace(/[^a-zA-Z0-9_]/g, "_");
      await tx.unsafe(`insert into lithotripsy_pricing_definitions(stable_key,label,category,default_amount,effect,sort_order,active,created_by_user_id,updated_at)
        values($1,$2,'fixed_accountant_line',$3::numeric,$4::work_form_financial_effect,(select coalesce(max(sort_order),-1)+1 from lithotripsy_pricing_definitions),true,$5::uuid,now())`, [stableKey, label, amount, String(input.effect ?? "subtract"), userId]);
    } else {
      const id = String(input.id ?? "");
      if (action === "archive") await tx.unsafe("update lithotripsy_pricing_definitions set active=false,updated_at=now() where id=$1::uuid", [id]);
      else if (action === "update") {
        const amount = input.defaultAmount == null || input.defaultAmount === "" ? null : Number(input.defaultAmount);
        if (amount != null && (!Number.isFinite(amount) || amount < 0)) throw new OperationDomainError(400, "LITHO_PRICING_INVALID", "السعر الافتراضي غير صالح.");
        await tx.unsafe("update lithotripsy_pricing_definitions set label=coalesce($2,label),default_amount=$3::numeric,effect=coalesce($4::work_form_financial_effect,effect),updated_at=now() where id=$1::uuid", [id, input.label == null ? null : String(input.label).trim().replace(/\s+/gu, " "), amount, input.effect == null ? null : String(input.effect)]);
      }
    }
    return listLithotripsyPricing(tx);
  });
}
export type ReviewPricingOrigin = "specific_source_default" | "profile_role_default" | "none" | "session_profile_line" | "profile_fixed_line";
export type ResolvedLithotripsyPrice = { source: FinancialSource | null; definitionId: string; stableKey: string; label: string; defaultAmount: number | null; effect: "add" | "subtract" | "neutral"; pricingOrigin: ReviewPricingOrigin; layoutStableKey?: string; profileId?: string | null; profileLineId?: string; profileVersion?: number | null; profileMatchType?: ProfileMatchType };
export type LithotripsyResolvedPrices = Array<ResolvedLithotripsyPrice> & { profileId: string | null; profileName: string | null; profileVersion: number | null; profileMatchType: ProfileMatchType; procedureIds: string[]; procedureSetKey: string; sessionNumber: number; sessionId: string; sessionName: string; warningCode: string | null; warningMessage: string | null };
export async function resolveLithotripsyReviewDefaults(operationId: string, db: Executor = postgresClient) {
  const matchedProfile = await resolveLithotripsyPricingProfile(operationId, db);
  const sources = (await getOperationFinancialSources(operationId, db)).costSources;
  const resolved: ResolvedLithotripsyPrice[] = [];
  const seenSources = new Set<string>();
  if (matchedProfile.profile) {
    const lines = matchedProfile.profile.lines.filter((line) => line.active);
    for (const source of sources) {
      const identity = `${source.sourceType}:${source.sourceReferenceId ?? source.sourceId ?? ""}`;
      if (seenSources.has(identity)) continue;
      seenSources.add(identity);
      const sourcePrice = resolveSourcePrice({ profileLines: lines, sourceType: source.sourceType, sourceReferenceId: source.sourceReferenceId });
      const line = sourcePrice.matchedLine;
      const origins: Record<SourcePricingOrigin, ReviewPricingOrigin> = { specific: "specific_source_default", generic: "profile_role_default", none: "none" };
      resolved.push({ source, definitionId: line?.pricingDefinitionId ?? "", stableKey: line?.stableKey ?? `${source.sourceType}_source`, label: `${source.contextLabel} — ${source.label}`, defaultAmount: sourcePrice.resolvedAmount, effect: line?.effect ?? source.defaultEffect, pricingOrigin: origins[sourcePrice.origin], layoutStableKey: undefined, profileId: matchedProfile.profile.id, profileLineId: line?.id ?? "", profileVersion: matchedProfile.profile.version, profileMatchType: matchedProfile.matchType });
    }
    const session = matchedProfile.sessionNumber;
    for (const line of lines.filter((item) => item.lineType === "fixed_cost" || (item.lineType === "session_cost" && item.sessionValue === session))) {
      resolved.push({ source: null, definitionId: line.pricingDefinitionId ?? "", stableKey: line.stableKey, label: line.label, defaultAmount: line.defaultAmount, effect: line.effect, pricingOrigin: line.lineType === "session_cost" ? "session_profile_line" : "profile_fixed_line", layoutStableKey: line.stableKey === "nursing_workers" ? "nursing_workers" : line.lineType === "session_cost" ? "session_expenses" : undefined, profileId: matchedProfile.profile.id, profileLineId: line.id, profileVersion: matchedProfile.profile.version, profileMatchType: matchedProfile.matchType });
    }
    const result = resolved as LithotripsyResolvedPrices;
    Object.assign(result, { profileId: matchedProfile.profile.id, profileName: matchedProfile.profile.name, profileVersion: matchedProfile.profile.version, profileMatchType: matchedProfile.matchType, procedureIds: matchedProfile.procedureIds, procedureSetKey: matchedProfile.procedureSetKey, sessionNumber: matchedProfile.sessionNumber, sessionId: matchedProfile.sessionId, sessionName: matchedProfile.sessionName, warningCode: matchedProfile.warningCode, warningMessage: matchedProfile.warningMessage });
    return result;
  }
  for (const source of sources) {
    const identity = `${source.sourceType}:${source.sourceReferenceId ?? source.sourceId ?? ""}`;
    if (seenSources.has(identity)) continue;
    seenSources.add(identity);
    resolved.push({ source, definitionId: "", stableKey: `${source.sourceType}_source`, label: `${source.contextLabel} — ${source.label}`, defaultAmount: null, effect: source.defaultEffect, pricingOrigin: "none" });
  }
  const result = resolved as LithotripsyResolvedPrices;
  Object.assign(result, { profileId: null, profileName: null, profileVersion: null, profileMatchType: matchedProfile.matchType, procedureIds: matchedProfile.procedureIds, procedureSetKey: matchedProfile.procedureSetKey, sessionNumber: matchedProfile.sessionNumber, sessionId: matchedProfile.sessionId, sessionName: matchedProfile.sessionName, warningCode: matchedProfile.warningCode, warningMessage: matchedProfile.warningMessage });
  return result;
}
