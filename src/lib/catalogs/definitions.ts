import { z } from "zod";

import {
  anesthesiologists,
  anesthesiaTypes,
  consumables,
  stents,
  contractEntities,
  doctors,
  equipment,
  financialItemCatalog,
  hospitals,
  procedures,
  technicians,
} from "@/db/schema";

const nullableText = (maximum: number) =>
  z.string().trim().max(maximum).nullable().optional();

const commonCreate = {
  name: z.string().trim().min(2, "الاسم مطلوب.").max(200, "الاسم طويل جداً."),
  isActive: z.boolean().optional(),
};

const doctorFields = {
  specialty: nullableText(150),
  phone: nullableText(50),
};

const hospitalFields = {
  address: nullableText(1000),
  contractEntityId: z.string().uuid("جهة التعاقد غير صحيحة.").nullable().optional(),
};

const procedureFields = {
  category: z.string().trim().min(1, "تصنيف الإجراء مطلوب.").max(120),
  supportsSide: z.boolean().optional(),
};

const equipmentFields = {
  equipmentType: z.string().trim().min(1, "نوع الجهاز مطلوب.").max(120),
  fixedHospitalId: z.string().uuid("المستشفى الثابت غير صحيح.").nullable().optional(),
};

const financialFields = {
  defaultKind: z.enum(["financial", "note"]),
  defaultAmount: z.number().finite().nonnegative().nullable().optional(),
};

const validateFinancial = (
  value: { defaultKind?: "financial" | "note"; defaultAmount?: number | null },
  context: z.RefinementCtx,
) => {
  if (value.defaultKind === "note" && value.defaultAmount != null) {
    context.addIssue({
      code: "custom",
      path: ["defaultAmount"],
      message: "البند النصي لا يمكن أن يحتوي على مبلغ افتراضي.",
    });
  }
};

const definitions = {
  doctors: {
    table: doctors,
    tableName: "doctors",
    createSchema: z.object({ ...commonCreate, ...doctorFields }).strict(),
    updateSchema: z.object({ ...commonCreate, ...doctorFields }).partial().strict(),
    columns: { specialty: "specialty", phone: "phone" },
  },
  "contract-entities": {
    table: contractEntities,
    tableName: "contract_entities",
    createSchema: z.object({
      ...commonCreate,
      entityType: z.enum(["health_insurance", "contracted_hospital", "other"]),
    }).strict(),
    updateSchema: z.object({
      ...commonCreate,
      entityType: z.enum(["health_insurance", "contracted_hospital", "other"]),
    }).partial().strict(),
    columns: { entityType: "entity_type" },
  },
  hospitals: {
    table: hospitals,
    tableName: "hospitals",
    createSchema: z.object({ ...commonCreate, ...hospitalFields }).strict(),
    updateSchema: z.object({ ...commonCreate, ...hospitalFields }).partial().strict(),
    columns: { address: "address", contractEntityId: "contract_entity_id" },
  },
  procedures: {
    table: procedures,
    tableName: "procedures",
    createSchema: z.object({ ...commonCreate, ...procedureFields }).strict(),
    updateSchema: z.object({ ...commonCreate, ...procedureFields }).partial().strict(),
    columns: { category: "category", supportsSide: "supports_side" },
  },
  equipment: {
    table: equipment,
    tableName: "equipment",
    createSchema: z.object({ ...commonCreate, ...equipmentFields }).strict(),
    updateSchema: z.object({ ...commonCreate, ...equipmentFields }).partial().strict(),
    columns: { equipmentType: "equipment_type", fixedHospitalId: "fixed_hospital_id" },
  },
  consumables: {
    table: consumables,
    tableName: "consumables",
    createSchema: z.object({
      ...commonCreate,
      defaultNote: nullableText(2000),
    }).strict(),
    updateSchema: z.object({
      ...commonCreate,
      defaultNote: nullableText(2000),
    }).partial().strict(),
    columns: { defaultNote: "default_note" },
  },
  stents: {
    table: stents,
    tableName: "stents",
    createSchema: z.object({ ...commonCreate, stentType: nullableText(120) }).strict(),
    updateSchema: z.object({ ...commonCreate, stentType: nullableText(120) }).partial().strict(),
    columns: { stentType: "stent_type" },
  },
  anesthesiologists: {
    table: anesthesiologists,
    tableName: "anesthesiologists",
    createSchema: z.object({
      ...commonCreate,
      phone: nullableText(50),
    }).strict(),
    updateSchema: z.object({
      ...commonCreate,
      phone: nullableText(50),
    }).partial().strict(),
    columns: { phone: "phone" },
  },
  "anesthesia-types": {
    table: anesthesiaTypes,
    tableName: "anesthesia_types",
    createSchema: z.object({ ...commonCreate }).strict(),
    updateSchema: z.object({ ...commonCreate }).partial().strict(),
    columns: {},
  },
  technicians: {
    table: technicians,
    tableName: "technicians",
    createSchema: z.object({
      ...commonCreate,
      linkedUserId: z.string().uuid("المستخدم المرتبط غير صحيح.").nullable().optional(),
    }).strict(),
    updateSchema: z.object({
      ...commonCreate,
      linkedUserId: z.string().uuid("المستخدم المرتبط غير صحيح.").nullable().optional(),
    }).partial().strict(),
    columns: { linkedUserId: "linked_user_id" },
  },
  "financial-items": {
    table: financialItemCatalog,
    tableName: "financial_item_catalog",
    createSchema: z.object({ ...commonCreate, ...financialFields })
      .strict()
      .superRefine(validateFinancial),
    updateSchema: z.object({ ...commonCreate, ...financialFields })
      .partial()
      .strict()
      .superRefine(validateFinancial),
    columns: { defaultKind: "default_kind", defaultAmount: "default_amount" },
  },
} as const;

export type CatalogType = keyof typeof definitions;
export type CatalogDefinition = (typeof definitions)[CatalogType];

export function getCatalogDefinition(type: string): CatalogDefinition | null {
  return Object.prototype.hasOwnProperty.call(definitions, type)
    ? definitions[type as CatalogType]
    : null;
}

export const catalogTypes = Object.keys(definitions) as CatalogType[];
