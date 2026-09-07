import type { FieldType, OperationType, SmartDropdownSource } from "./types";
import { WorkFormDomainError } from "./validation";

export type SystemFieldCapability = {
  canHideFromForm: boolean;
  canChangeRequired: boolean;
  canChangeType: boolean;
  canArchive: boolean;
};
const locked: SystemFieldCapability = { canHideFromForm: false, canChangeRequired: false, canChangeType: false, canArchive: false };
const optional: SystemFieldCapability = { canHideFromForm: true, canChangeRequired: true, canChangeType: false, canArchive: true };
const requiredRelationship = (type: OperationType, key: string): SystemFieldCapability => {
  if (key === "doctor" && type === "contract") return { ...optional, canArchive: true };
  if (key === "hospital" && type === "contract") return { ...optional, canArchive: false };
  return locked;
};
export function systemFieldCapability(type: OperationType, stableKey: string): SystemFieldCapability {
  if (["case_name", "operation_date", "operation_time"].includes(stableKey)) return locked;
  if (stableKey === "participants") return { ...optional, canChangeType: true };
  if (stableKey === "doctor" || stableKey === "hospital") return requiredRelationship(type, stableKey);
  if (stableKey === "procedures") return { ...locked, canChangeRequired: true };
  return optional;
}
export function assertSystemFieldMutation(type: OperationType, current: {
  stableKey: string; fieldType: FieldType; required: boolean; showInForm: boolean;
  smartDropdownSource: SmartDropdownSource | null;
}, next: { fieldType: FieldType; required: boolean; showInForm: boolean; smartDropdownSource: SmartDropdownSource | null }) {
  const capability = systemFieldCapability(type, current.stableKey);
  if (!capability.canChangeType && (next.fieldType !== current.fieldType || next.smartDropdownSource !== current.smartDropdownSource)) {
    throw new WorkFormDomainError(409, "SYSTEM_FIELD_TYPE_PROTECTED", "نوع ومصدر حقل النظام محميان.");
  }
  if (!capability.canChangeRequired && next.required !== current.required) {
    throw new WorkFormDomainError(409, "SYSTEM_FIELD_REQUIRED_PROTECTED", "إلزامية هذا الحقل محمية.");
  }
  if (!capability.canHideFromForm && !next.showInForm) {
    throw new WorkFormDomainError(409, "SYSTEM_FIELD_VISIBILITY_PROTECTED", "لا يمكن إخفاء هذا الحقل الأساسي.");
  }
}
