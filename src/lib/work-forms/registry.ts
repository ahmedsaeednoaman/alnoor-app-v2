import { postgresClient } from "@/db/client";
import type { SmartDropdownSource } from "./types";
import { WorkFormDomainError } from "./validation";

const registry: Record<SmartDropdownSource, { table: string; active: string; labelColumn: string }> = {
  doctors: { table: "doctors", active: "archived_at is null and is_active=true", labelColumn: "name" },
  hospitals: { table: "hospitals", active: "archived_at is null and is_active=true", labelColumn: "name" },
  procedures: { table: "procedures", active: "archived_at is null and is_active=true", labelColumn: "name" },
  equipment: { table: "equipment", active: "archived_at is null and is_active=true", labelColumn: "name" },
  consumables: { table: "consumables", active: "archived_at is null and is_active=true", labelColumn: "name" },
  stents: { table: "stents", active: "archived_at is null and is_active=true", labelColumn: "name" },
  anesthesiologists: { table: "anesthesiologists", active: "archived_at is null and is_active=true", labelColumn: "name" },
  technicians: { table: "technicians", active: "archived_at is null and is_active=true", labelColumn: "name" },
  contract_entities: { table: "contract_entities", active: "archived_at is null and is_active=true", labelColumn: "name" },
  anesthesia_types: { table: "anesthesia_types", active: "archived_at is null and is_active=true", labelColumn: "name" },
  users: { table: "users", active: "archived_at is null and status='active'", labelColumn: "display_name" },
};

export function resolveSmartDropdownSource(source: SmartDropdownSource) {
  const definition = registry[source];
  if (!definition) throw new WorkFormDomainError(400, "SMART_SOURCE_INVALID", "مصدر القائمة الذكية غير معتمد.");
  return definition;
}
export async function validateReferenceExists(source: SmartDropdownSource, id: string) {
  const definition = resolveSmartDropdownSource(source);
  const rows = await postgresClient.unsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS(SELECT 1 FROM "${definition.table}" WHERE id=$1::uuid AND ${definition.active}) AS exists`,
    [id],
  );
  if (!rows[0]?.exists) throw new WorkFormDomainError(400, "REFERENCE_NOT_FOUND", "القيمة المرجعية غير موجودة أو مؤرشفة.");
}
