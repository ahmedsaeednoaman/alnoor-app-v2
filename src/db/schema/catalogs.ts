import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "./auth";

export const contractEntityTypeEnum = pgEnum("contract_entity_type", [
  "health_insurance",
  "contracted_hospital",
  "other",
]);

export const financialItemKindEnum = pgEnum("financial_item_kind", [
  "financial",
  "note",
]);

const catalogColumns = () => ({
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  normalizedName: varchar("normalized_name", { length: 200 }).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const doctors = pgTable(
  "doctors",
  { ...catalogColumns(), specialty: varchar("specialty", { length: 150 }), phone: varchar("phone", { length: 50 }) },
  (table) => [
    uniqueIndex("doctors_current_name_unique").on(table.normalizedName).where(sql`${table.archivedAt} is null`),
    index("doctors_name_search_idx").on(table.normalizedName),
  ],
);

export const contractEntities = pgTable(
  "contract_entities",
  { ...catalogColumns(), entityType: contractEntityTypeEnum("entity_type").notNull() },
  (table) => [
    uniqueIndex("contract_entities_current_name_unique").on(table.normalizedName).where(sql`${table.archivedAt} is null`),
    index("contract_entities_name_search_idx").on(table.normalizedName),
  ],
);

export const hospitals = pgTable(
  "hospitals",
  {
    ...catalogColumns(),
    address: text("address"),
    contractEntityId: uuid("contract_entity_id").references(() => contractEntities.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
  },
  (table) => [
    uniqueIndex("hospitals_current_name_unique").on(table.normalizedName).where(sql`${table.archivedAt} is null`),
    index("hospitals_name_search_idx").on(table.normalizedName),
    index("hospitals_contract_entity_idx").on(table.contractEntityId),
  ],
);

export const procedures = pgTable(
  "procedures",
  {
    ...catalogColumns(),
    category: varchar("category", { length: 120 }).notNull(),
    supportsSide: boolean("supports_side").default(false).notNull(),
  },
  (table) => [
    uniqueIndex("procedures_current_name_unique").on(table.normalizedName).where(sql`${table.archivedAt} is null`),
    index("procedures_name_search_idx").on(table.normalizedName),
  ],
);

export const equipment = pgTable(
  "equipment",
  {
    ...catalogColumns(),
    equipmentType: varchar("equipment_type", { length: 120 }).notNull(),
    fixedHospitalId: uuid("fixed_hospital_id").references(() => hospitals.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
  },
  (table) => [
    uniqueIndex("equipment_current_name_unique").on(table.normalizedName).where(sql`${table.archivedAt} is null`),
    index("equipment_name_search_idx").on(table.normalizedName),
    index("equipment_fixed_hospital_idx").on(table.fixedHospitalId),
  ],
);

export const consumables = pgTable(
  "consumables",
  { ...catalogColumns(), defaultNote: text("default_note") },
  (table) => [
    uniqueIndex("consumables_current_name_unique").on(table.normalizedName).where(sql`${table.archivedAt} is null`),
    index("consumables_name_search_idx").on(table.normalizedName),
  ],
);

export const stents = pgTable(
  "stents",
  { ...catalogColumns(), stentType: varchar("stent_type", { length: 120 }) },
  (table) => [
    uniqueIndex("stents_current_name_unique").on(table.normalizedName).where(sql`${table.archivedAt} is null`),
    index("stents_name_search_idx").on(table.normalizedName),
  ],
);

export const anesthesiologists = pgTable(
  "anesthesiologists",
  { ...catalogColumns(), phone: varchar("phone", { length: 50 }) },
  (table) => [
    uniqueIndex("anesthesiologists_current_name_unique").on(table.normalizedName).where(sql`${table.archivedAt} is null`),
    index("anesthesiologists_name_search_idx").on(table.normalizedName),
  ],
);

export const anesthesiaTypes = pgTable(
  "anesthesia_types",
  { ...catalogColumns() },
  (table) => [
    uniqueIndex("anesthesia_types_current_name_unique").on(table.normalizedName).where(sql`${table.archivedAt} is null`),
    index("anesthesia_types_name_search_idx").on(table.normalizedName),
  ],
);

export const technicians = pgTable(
  "technicians",
  {
    ...catalogColumns(),
    linkedUserId: uuid("linked_user_id").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
  },
  (table) => [
    uniqueIndex("technicians_current_name_unique").on(table.normalizedName).where(sql`${table.archivedAt} is null`),
    index("technicians_name_search_idx").on(table.normalizedName),
    index("technicians_linked_user_idx").on(table.linkedUserId),
  ],
);

export const financialItemCatalog = pgTable(
  "financial_item_catalog",
  {
    ...catalogColumns(),
    defaultKind: financialItemKindEnum("default_kind").notNull(),
    defaultAmount: numeric("default_amount", {
      precision: 12,
      scale: 2,
      mode: "number",
    }),
  },
  (table) => [
    uniqueIndex("financial_item_catalog_current_name_unique").on(table.normalizedName).where(sql`${table.archivedAt} is null`),
    index("financial_item_catalog_name_search_idx").on(table.normalizedName),
    check(
      "financial_item_note_amount_null_check",
      sql`${table.defaultKind} <> 'note' or ${table.defaultAmount} is null`,
    ),
    check(
      "financial_item_amount_nonnegative_check",
      sql`${table.defaultAmount} is null or ${table.defaultAmount} >= 0`,
    ),
  ],
);
