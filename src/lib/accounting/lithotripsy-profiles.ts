import { postgresClient } from "@/db/client";
import { normalizeCatalogName } from "@/lib/catalogs/normalize-name";
import { OperationDomainError } from "@/lib/operations/api";
import { requireLithotripsySession, requireLithotripsySessionById } from "@/lib/accounting/lithotripsy-sessions";

type Executor = Pick<typeof postgresClient, "unsafe">;
type Row = Record<string, unknown>;
export type ProfileLineType = "linked_role" | "linked_source" | "fixed_cost" | "session_cost";
export type LithotripsySessionNumber = number;
export type ProfileMatchType = "exact" | "session_base" | "legacy" | "none";
export type LithotripsyProfileLine = {
  id: string;
  profileId: string;
  pricingDefinitionId: string | null;
  stableKey: string;
  lineType: ProfileLineType;
  label: string;
  defaultAmount: number | null;
  effect: "add" | "subtract" | "neutral";
  sourceType: string | null;
  sourceReferenceId: string | null;
  sessionValue: number | null;
  sortOrder: number;
  active: boolean;
};
export type LithotripsyPricingProfile = {
  id: string;
  name: string;
  normalizedName: string;
  procedureSetKey: string;
  sessionNumber: LithotripsySessionNumber | null;
  sessionId: string | null;
  sessionName: string | null;
  isBase: boolean;
  active: boolean;
  version: number;
  sortOrder: number;
  archivedAt: string | null;
  procedures: Array<{ id: string; name: string; sortOrder: number }>;
  lines: LithotripsyProfileLine[];
};
export type ResolvedLithotripsyProfile = {
  profile: LithotripsyPricingProfile | null;
  matchType: ProfileMatchType;
  procedureIds: string[];
  procedureSetKey: string;
  sessionNumber: LithotripsySessionNumber;
  sessionId: string;
  sessionName: string;
  warningCode: "LITHO_PRICING_NOT_CONFIGURED" | "LITHO_LEGACY_PROFILE" | null;
  warningMessage: string | null;
};

const lineTypes = new Set<ProfileLineType>(["linked_role", "linked_source", "fixed_cost", "session_cost"]);
const effects = new Set(["add", "subtract", "neutral"]);
const normalizeKey = (ids: string[]) => Array.from(new Set(ids.map(String))).sort().join(",");
export const normalizeProcedureSet = normalizeKey;
export function calculateProfileLineEffectiveAmount(baseAmount: number, adjustmentAmount = 0) {
  if (!Number.isFinite(baseAmount) || baseAmount < 0 || !Number.isFinite(adjustmentAmount)) throw new OperationDomainError(400, "LITHO_PROFILE_AMOUNT_INVALID", "قيمة بند التسعير غير صالحة.");
  const effectiveAmount = baseAmount + adjustmentAmount;
  if (effectiveAmount < 0) throw new OperationDomainError(400, "LITHO_PROFILE_EFFECTIVE_NEGATIVE", "لا يمكن أن تصبح قيمة البند أقل من صفر.");
  return effectiveAmount;
}
const slug = (value: string) => normalizeCatalogName(value).replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "").slice(0, 90) || "line";
const money = (value: unknown) => value == null || value === "" ? null : Number(value);
const sessionLabel = (sessionNumber: LithotripsySessionNumber, name?: string | null) => name || `الجلسة رقم ${sessionNumber}`;
export function validateLithotripsySessionNumber(value: unknown): LithotripsySessionNumber {
  const sessionNumber = Number(value);
  if (!Number.isInteger(sessionNumber) || sessionNumber < 1) throw new OperationDomainError(400, "LITHO_PROFILE_SESSION_INVALID", "حدد الجلسة الصالحة لقائمة الأسعار.");
  return sessionNumber;
}
const profileLine = (row: Row): LithotripsyProfileLine => ({
  id: String(row.id), profileId: String(row.profile_id), pricingDefinitionId: row.pricing_definition_id == null ? null : String(row.pricing_definition_id),
  stableKey: String(row.stable_key), lineType: String(row.line_type) as ProfileLineType, label: String(row.label),
  defaultAmount: money(row.default_amount), effect: String(row.effect) as LithotripsyProfileLine["effect"],
  sourceType: row.source_type == null ? null : String(row.source_type), sourceReferenceId: row.source_reference_id == null ? null : String(row.source_reference_id),
  sessionValue: row.session_value == null ? null : Number(row.session_value), sortOrder: Number(row.sort_order), active: Boolean(row.active),
});

async function loadProfile(id: string, db: Executor, includeArchived = true): Promise<LithotripsyPricingProfile | null> {
  const [row] = await db.unsafe<Row[]>(`select p.*,s.name session_name from lithotripsy_pricing_profiles p left join lithotripsy_sessions s on s.id=p.session_id where p.id=$1::uuid${includeArchived ? "" : " and p.active=true and p.archived_at is null"}`, [id]);
  if (!row) return null;
  const procedures = await db.unsafe<Row[]>("select p.id,p.name,x.sort_order from lithotripsy_pricing_profile_procedures x join procedures p on p.id=x.procedure_id where x.profile_id=$1::uuid order by x.sort_order,p.name", [id]);
  const lines = await db.unsafe<Row[]>("select * from lithotripsy_pricing_profile_lines where profile_id=$1::uuid order by sort_order,id", [id]);
  return {
    id: String(row.id), name: String(row.name), normalizedName: String(row.normalized_name), procedureSetKey: String(row.procedure_set_key),
    sessionNumber: row.session_number == null ? null : validateLithotripsySessionNumber(row.session_number),
    sessionId: row.session_id == null ? null : String(row.session_id), sessionName: row.session_name == null ? null : String(row.session_name),
    isBase: Boolean(row.is_base), active: Boolean(row.active), version: Number(row.version), sortOrder: Number(row.sort_order),
    archivedAt: row.archived_at == null ? null : new Date(String(row.archived_at)).toISOString(),
    procedures: procedures.map((item) => ({ id: String(item.id), name: String(item.name), sortOrder: Number(item.sort_order) })),
    lines: lines.map(profileLine),
  };
}

export async function listLithotripsyProfiles(db: Executor = postgresClient) {
  const rows = await db.unsafe<Row[]>("select id from lithotripsy_pricing_profiles order by active desc,is_base desc,sort_order,id");
  const profiles = await Promise.all(rows.map((row) => loadProfile(String(row.id), db)));
  return profiles.filter(Boolean) as LithotripsyPricingProfile[];
}

async function validateProcedures(db: Executor, procedureIds: string[]) {
  const ids = Array.from(new Set(procedureIds.map(String)));
  if (!ids.length) throw new OperationDomainError(400, "LITHO_PROFILE_PROCEDURES_REQUIRED", "اختر إجراءً واحداً على الأقل للقالب.");
  const rows = await db.unsafe<Row[]>("select id from procedures where id=any($1::uuid[]) and archived_at is null and is_active=true", [ids]);
  if (rows.length !== ids.length) throw new OperationDomainError(400, "LITHO_PROFILE_PROCEDURE_INVALID", "أحد الإجراءات غير متاح أو مؤرشف.");
  return ids;
}

type LineInput = {
  stableKey?: string;
  lineType: ProfileLineType;
  label: string;
  defaultAmount?: number | string | null;
  effect?: "add" | "subtract" | "neutral";
  sourceType?: string | null;
  sourceReferenceId?: string | null;
  sessionValue?: number | null;
  pricingDefinitionId?: string | null;
};
export function financialSourceIdentity(line: Pick<LineInput, "lineType" | "sourceType" | "sourceReferenceId">) {
  if (line.lineType === "linked_role" && line.sourceType) return `role:${line.sourceType}`;
  if (line.lineType === "linked_source" && line.sourceType && line.sourceReferenceId) return `source:${line.sourceType}:${line.sourceReferenceId}`;
  return null;
}
export function assertUniqueFinancialSources(lines: Array<Pick<LineInput, "lineType" | "sourceType" | "sourceReferenceId">>) {
  const identities = lines.map(financialSourceIdentity).filter((identity): identity is string => Boolean(identity));
  if (new Set(identities).size !== identities.length) throw new OperationDomainError(409, "LITHO_PROFILE_SOURCE_DUPLICATE", "لا يمكن إضافة نفس المصدر المالي أكثر من مرة داخل القالب.");
}
function validateLines(lines: LineInput[]) {
  assertUniqueFinancialSources(lines);
  const keys = new Set<string>();
  return lines.map((line, index) => {
    if (!lineTypes.has(line.lineType)) throw new OperationDomainError(400, "LITHO_PROFILE_LINE_TYPE_INVALID", "نوع بند التسعير غير صالح.");
    const label = String(line.label ?? "").trim().replace(/\s+/gu, " ");
    if (label.length < 2) throw new OperationDomainError(400, "LITHO_PROFILE_LINE_LABEL_REQUIRED", "اسم بند التسعير مطلوب.");
    const amount = line.defaultAmount == null || line.defaultAmount === "" ? null : Number(line.defaultAmount);
    if (amount != null && (!Number.isFinite(amount) || amount < 0)) throw new OperationDomainError(400, "LITHO_PROFILE_LINE_AMOUNT_INVALID", "السعر الافتراضي غير صالح.");
    if (line.lineType === "session_cost" && ![1, 2].includes(Number(line.sessionValue))) throw new OperationDomainError(400, "LITHO_PROFILE_SESSION_REQUIRED", "حدد الجلسة الخاصة ببند التسعير.");
    if (line.lineType === "linked_role" && !line.sourceType) throw new OperationDomainError(400, "LITHO_PROFILE_SOURCE_REQUIRED", "حدد الدور المرتبط ببند التسعير.");
    if (line.lineType === "linked_source" && (!line.sourceType || !line.sourceReferenceId)) throw new OperationDomainError(400, "LITHO_PROFILE_SOURCE_REQUIRED", "حدد المصدر والعنصر المرتبط ببند التسعير.");
    const stableKey = String(line.stableKey ?? `${line.lineType}_${slug(label)}_${index}`).replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 120);
    if (keys.has(stableKey)) throw new OperationDomainError(400, "LITHO_PROFILE_LINE_DUPLICATE", "لا يمكن تكرار بند التسعير داخل القالب.");
    keys.add(stableKey);
    const effect = line.effect ?? "subtract";
    if (!effects.has(effect)) throw new OperationDomainError(400, "LITHO_PROFILE_EFFECT_INVALID", "تأثير البند غير صالح.");
    return { stableKey, lineType: line.lineType, label, amount, effect, sourceType: line.sourceType ? String(line.sourceType) : null, sourceReferenceId: line.sourceReferenceId ? String(line.sourceReferenceId) : null, sessionValue: line.sessionValue == null ? null : Number(line.sessionValue), pricingDefinitionId: line.pricingDefinitionId ? String(line.pricingDefinitionId) : null, sortOrder: index };
  });
}

async function insertLines(tx: Executor, profileId: string, lines: ReturnType<typeof validateLines>, userId: string) {
  for (const line of lines) await tx.unsafe(`insert into lithotripsy_pricing_profile_lines(profile_id,pricing_definition_id,stable_key,line_type,label,default_amount,effect,source_type,source_reference_id,session_value,sort_order,active,created_by_user_id,updated_by_user_id,updated_at) values($1::uuid,$2::uuid,$3,$4::lithotripsy_pricing_profile_line_type,$5,$6::numeric,$7::work_form_financial_effect,$8,$9::uuid,$10,$11,true,$12::uuid,$12::uuid,now())`, [profileId, line.pricingDefinitionId, line.stableKey, line.lineType, line.label, line.amount, line.effect, line.sourceType, line.sourceReferenceId, line.sessionValue, line.sortOrder, userId]);
}

export async function createLithotripsyProfile(input: { name: string; sessionId?: string; sessionNumber?: number; procedureIds: string[]; isBase?: boolean; lines: LineInput[] }, userId: string) {
  return postgresClient.begin(async (tx) => {
    const session = input.sessionId ? await requireLithotripsySessionById(input.sessionId, tx) : await requireLithotripsySession(validateLithotripsySessionNumber(input.sessionNumber), tx);
    const sessionNumber = session.sessionNumber;
    const procedureIds = await validateProcedures(tx, input.procedureIds);
    const procedureSetKey = normalizeKey(procedureIds);
    const [duplicate] = await tx.unsafe<Row[]>("select id from lithotripsy_pricing_profiles where session_id=$1::uuid and procedure_set_key=$2 and active=true and archived_at is null", [session.id, procedureSetKey]);
    if (duplicate) throw new OperationDomainError(409, "LITHO_PROFILE_DUPLICATE_SET", `توجد بالفعل قائمة أسعار نشطة في ${sessionLabel(sessionNumber,session.name)} لنفس مجموعة الإجراءات.`);
    if (input.isBase) {
      const [duplicateBase] = await tx.unsafe<Row[]>("select id from lithotripsy_pricing_profiles where session_id=$1::uuid and active=true and archived_at is null and is_base=true", [session.id]);
      if (duplicateBase) throw new OperationDomainError(409, "LITHO_PROFILE_DUPLICATE_BASE", `يوجد بالفعل قالب أساسي نشط ${sessionLabel(sessionNumber)}.`);
    }
    const lines = validateLines(input.lines ?? []);
    const name = String(input.name ?? "").trim().replace(/\s+/gu, " ");
    if (name.length < 2) throw new OperationDomainError(400, "LITHO_PROFILE_NAME_REQUIRED", "اسم القالب مطلوب.");
    const [row] = await tx.unsafe<Row[]>("insert into lithotripsy_pricing_profiles(name,normalized_name,procedure_set_key,session_number,session_id,is_base,active,version,sort_order,created_by_user_id,updated_by_user_id,updated_at) values($1,$2,$3,$4,$5::uuid,$6,true,1,(select coalesce(max(sort_order),-1)+1 from lithotripsy_pricing_profiles),$7::uuid,$7::uuid,now()) returning id", [name, normalizeCatalogName(name), procedureSetKey, sessionNumber, session.id, Boolean(input.isBase), userId]);
    for (const [sortOrder, id] of procedureIds.entries()) await tx.unsafe("insert into lithotripsy_pricing_profile_procedures(profile_id,procedure_id,sort_order) values($1::uuid,$2::uuid,$3)", [String(row.id), id, sortOrder]);
    await insertLines(tx, String(row.id), lines, userId);
    return loadProfile(String(row.id), tx);
  });
}

export async function updateLithotripsyProfile(id: string, input: { name: string; sessionId?: string; sessionNumber?: number; procedureIds: string[]; isBase?: boolean; lines: LineInput[] }, userId: string) {
  return postgresClient.begin(async (tx) => {
    const current = await loadProfile(id, tx, false);
    if (!current) throw new OperationDomainError(404, "LITHO_PROFILE_NOT_FOUND", "قالب التسعير غير موجود.");
    const session = input.sessionId ? await requireLithotripsySessionById(input.sessionId, tx) : await requireLithotripsySession(validateLithotripsySessionNumber(input.sessionNumber), tx);
    const sessionNumber = session.sessionNumber;
    const procedureIds = await validateProcedures(tx, input.procedureIds);
    const procedureSetKey = normalizeKey(procedureIds);
    const [duplicate] = await tx.unsafe<Row[]>("select id from lithotripsy_pricing_profiles where session_id=$1::uuid and procedure_set_key=$2 and active=true and archived_at is null and id<>$3::uuid", [session.id, procedureSetKey, id]);
    if (duplicate) throw new OperationDomainError(409, "LITHO_PROFILE_DUPLICATE_SET", `يوجد بالفعل قالب أسعار نشط ${sessionLabel(sessionNumber)} ونفس مجموعة الإجراءات.`);
    if (input.isBase) {
      const [duplicateBase] = await tx.unsafe<Row[]>("select id from lithotripsy_pricing_profiles where session_id=$1::uuid and active=true and archived_at is null and is_base=true and id<>$2::uuid", [session.id, id]);
      if (duplicateBase) throw new OperationDomainError(409, "LITHO_PROFILE_DUPLICATE_BASE", `يوجد بالفعل قالب أساسي نشط ${sessionLabel(sessionNumber)}.`);
    }
    const lines = validateLines(input.lines ?? []);
    const name = String(input.name ?? "").trim().replace(/\s+/gu, " ");
    if (name.length < 2) throw new OperationDomainError(400, "LITHO_PROFILE_NAME_REQUIRED", "اسم القالب مطلوب.");
    await tx.unsafe("update lithotripsy_pricing_profiles set name=$2,normalized_name=$3,procedure_set_key=$4,session_number=$5,session_id=$6::uuid,is_base=$7,version=version+1,updated_by_user_id=$8::uuid,updated_at=now() where id=$1::uuid", [id, name, normalizeCatalogName(name), procedureSetKey, sessionNumber, session.id, Boolean(input.isBase), userId]);
    await tx.unsafe("delete from lithotripsy_pricing_profile_procedures where profile_id=$1::uuid", [id]);
    for (const [sortOrder, procedureId] of procedureIds.entries()) await tx.unsafe("insert into lithotripsy_pricing_profile_procedures(profile_id,procedure_id,sort_order) values($1::uuid,$2::uuid,$3)", [id, procedureId, sortOrder]);
    await tx.unsafe("update lithotripsy_pricing_profile_lines set active=false,stable_key=left(stable_key || '__archived_' || substring(id::text,1,8),120),archived_at=now(),updated_at=now(),updated_by_user_id=$2::uuid where profile_id=$1::uuid and active=true", [id, userId]);
    await insertLines(tx, id, lines, userId);
    return loadProfile(id, tx);
  });
}

export async function archiveLithotripsyProfile(id: string, userId: string) {
  return postgresClient.begin(async (tx) => {
    const [row] = await tx.unsafe<Row[]>("select id,is_base from lithotripsy_pricing_profiles where id=$1::uuid and active=true and archived_at is null for update", [id]);
    if (!row) throw new OperationDomainError(404, "LITHO_PROFILE_NOT_FOUND", "قالب التسعير غير موجود.");
    if (Boolean(row.is_base)) throw new OperationDomainError(409, "LITHO_BASE_PROFILE_REQUIRED", "عيّن قالباً أساسياً آخر قبل أرشفة القالب الأساسي الحالي.");
    await tx.unsafe("update lithotripsy_pricing_profiles set active=false,archived_at=now(),updated_by_user_id=$2::uuid,updated_at=now() where id=$1::uuid", [id, userId]);
    await tx.unsafe("update lithotripsy_pricing_profile_lines set active=false,archived_at=now(),updated_by_user_id=$2::uuid,updated_at=now() where profile_id=$1::uuid and active=true", [id, userId]);
    return loadProfile(id, tx);
  });
}

export async function restoreLithotripsyProfile(id: string, userId: string) {
  return postgresClient.begin(async (tx) => {
    const profile = await loadProfile(id, tx);
    if (!profile) throw new OperationDomainError(404, "LITHO_PROFILE_NOT_FOUND", "قالب التسعير غير موجود.");
    const [duplicate] = profile.sessionNumber == null
      ? await tx.unsafe<Row[]>("select id from lithotripsy_pricing_profiles where session_number is null and procedure_set_key=$1 and active=true and archived_at is null and id<>$2::uuid", [profile.procedureSetKey, id])
      : await tx.unsafe<Row[]>("select id from lithotripsy_pricing_profiles where session_number=$1 and procedure_set_key=$2 and active=true and archived_at is null and id<>$3::uuid", [profile.sessionNumber, profile.procedureSetKey, id]);
    if (duplicate) throw new OperationDomainError(409, "LITHO_PROFILE_DUPLICATE_SET", profile.sessionNumber == null ? "يوجد قالب قديم نشط آخر مرتبط بنفس مجموعة الإجراءات." : `يوجد بالفعل قالب أسعار نشط ${sessionLabel(profile.sessionNumber)} ونفس مجموعة الإجراءات.`);
    if (profile.isBase) {
      const [duplicateBase] = profile.sessionNumber == null
        ? await tx.unsafe<Row[]>("select id from lithotripsy_pricing_profiles where session_number is null and active=true and archived_at is null and is_base=true and id<>$1::uuid", [id])
        : await tx.unsafe<Row[]>("select id from lithotripsy_pricing_profiles where session_number=$1 and active=true and archived_at is null and is_base=true and id<>$2::uuid", [profile.sessionNumber, id]);
      if (duplicateBase) throw new OperationDomainError(409, "LITHO_PROFILE_DUPLICATE_BASE", profile.sessionNumber == null ? "يوجد قالب أساسي قديم نشط بالفعل." : `يوجد بالفعل قالب أساسي نشط ${sessionLabel(profile.sessionNumber)}.`);
    }
    await tx.unsafe("update lithotripsy_pricing_profiles set active=true,archived_at=null,updated_by_user_id=$2::uuid,updated_at=now() where id=$1::uuid", [id, userId]);
    await tx.unsafe("update lithotripsy_pricing_profile_lines set active=true,archived_at=null,updated_by_user_id=$2::uuid,updated_at=now() where profile_id=$1::uuid and archived_at = (select max(archived_at) from lithotripsy_pricing_profile_lines where profile_id=$1::uuid)", [id, userId]);
    return loadProfile(id, tx);
  });
}

export async function resolveLithotripsyPricingProfile(operationId: string, db: Executor = postgresClient): Promise<ResolvedLithotripsyProfile> {
  const [operation] = await db.unsafe<Row[]>("select type,session_count,lithotripsy_session_id from operations where id=$1::uuid", [operationId]);
  if (!operation || operation.type !== "lithotripsy") throw new OperationDomainError(404, "LITHO_OPERATION_NOT_FOUND", "حالة التفتيت غير موجودة.");
  const sessionNumber = validateLithotripsySessionNumber(operation.session_count);
  const rows = await db.unsafe<Row[]>("select procedure_id from operation_procedures where operation_id=$1::uuid order by procedure_id", [operationId]);
  const procedureIds = Array.from(new Set(rows.map((row) => String(row.procedure_id))));
  const key = normalizeKey(procedureIds);
  const session = operation.lithotripsy_session_id ? await requireLithotripsySessionById(String(operation.lithotripsy_session_id), db) : await requireLithotripsySession(sessionNumber, db);
  const [exact] = await db.unsafe<Row[]>("select id from lithotripsy_pricing_profiles where (session_id=$1::uuid or (session_id is null and session_number=$2)) and procedure_set_key=$3 and active=true and archived_at is null order by (session_id is not null) desc limit 1", [session.id, sessionNumber, key]);
  const [sessionBase] = exact ? [] : await db.unsafe<Row[]>("select id from lithotripsy_pricing_profiles where (session_id=$1::uuid or (session_id is null and session_number=$2)) and active=true and archived_at is null and is_base=true order by (session_id is not null) desc limit 1", [session.id, sessionNumber]);
  const [legacy] = exact || sessionBase ? [] : await db.unsafe<Row[]>("select id from lithotripsy_pricing_profiles where session_number is null and procedure_set_key=$1 and active=true and archived_at is null limit 1", [key]);
  const chosen = exact ?? sessionBase ?? legacy;
  if (!chosen) return { profile: null, matchType: "none", procedureIds, procedureSetKey: key, sessionNumber, sessionId: session.id, sessionName: session.name, warningCode: "LITHO_PRICING_NOT_CONFIGURED", warningMessage: "لا توجد قائمة أسعار مطابقة لهذه الجلسة والإجراءات." };
  const profile = await loadProfile(String(chosen.id), db, false);
  if (!profile) return { profile: null, matchType: "none", procedureIds, procedureSetKey: key, sessionNumber, sessionId: session.id, sessionName: session.name, warningCode: "LITHO_PRICING_NOT_CONFIGURED", warningMessage: "لا توجد قائمة أسعار مطابقة لهذه الجلسة والإجراءات." };
  const matchType: ProfileMatchType = exact ? "exact" : sessionBase ? "session_base" : "legacy";
  return { profile, matchType, procedureIds, procedureSetKey: key, sessionNumber, sessionId: session.id, sessionName: session.name, warningCode: matchType === "legacy" ? "LITHO_LEGACY_PROFILE" : null, warningMessage: matchType === "legacy" ? "تم استخدام قائمة قديمة بدون جلسة محددة للتوافق مع البيانات الحالية." : null };
}
