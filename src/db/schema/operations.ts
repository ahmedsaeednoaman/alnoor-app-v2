import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";
import {
  anesthesiologists,
  consumables,
  contractEntities,
  doctors,
  equipment,
  financialItemCatalog,
  hospitals,
  procedures,
  stents,
  technicians,
} from "./catalogs";

export const operationTypeEnum = pgEnum("operation_type", [
  "lithotripsy",
  "endoscopy",
  "contract",
]);
export const operationStatusEnum = pgEnum("operation_status", [
  "recorded",
  "cancelled",
]);
export const operationSideEnum = pgEnum("operation_side", [
  "right",
  "left",
  "bilateral",
]);
export const participantRoleEnum = pgEnum("operation_participant_role", [
  "operator",
  "nurse",
  "assistant",
  "lithotripsy_technician",
  "c_arm_technician",
  "other",
]);
export const reviewStatusEnum = pgEnum("financial_review_status", [
  "awaiting_review",
  "reviewed",
  "partially_paid",
  "paid",
]);
export const financialReviewAccountingModeEnum = pgEnum("financial_review_accounting_mode", [
  "main_amount",
  "direct_items",
]);
export const operationFinancialItemKindEnum = pgEnum(
  "operation_financial_item_kind",
  ["financial", "note"],
);
export const workFormTemplateStatusEnum = pgEnum("work_form_template_status", [
  "draft",
  "published",
  "archived",
]);
export const workFormFieldTypeEnum = pgEnum("work_form_field_type", [
  "text",
  "textarea",
  "number",
  "money",
  "date",
  "time",
  "boolean",
  "select",
  "smart_single",
  "smart_multi",
]);
export const workFormReferenceSourceEnum = pgEnum(
  "work_form_reference_source",
  [
    "doctors",
    "hospitals",
    "procedures",
    "equipment",
    "consumables",
    "anesthesiologists",
    "technicians",
    "contract_entities",
    "anesthesia_types",
    "stents",
    "users",
  ],
);
export const workFormFinancialEffectEnum = pgEnum(
  "work_form_financial_effect",
  ["add", "subtract", "neutral"],
);
export const workFormReviewRoleEnum = pgEnum("work_form_review_role", [
  "context",
  "cost_source",
  "hidden",
]);
export const financialItemSourceTypeEnum = pgEnum(
  "financial_item_source_type",
  ["dynamic_field", "anesthesiologist", "technician", "procedure", "equipment", "consumable", "stent", "manual", "other"],
);
export const financialReviewDefinitionKindEnum = pgEnum("financial_review_definition_kind", [
  "system",
  "accountant_input",
  "calculated",
  "operation_field",
]);
export const lithotripsyPricingProfileLineTypeEnum = pgEnum("lithotripsy_pricing_profile_line_type", [
  "linked_role",
  "linked_source",
  "fixed_cost",
  "session_cost",
]);
export const operationFinancialLineStateEnum = pgEnum("operation_financial_line_state", [
  "included",
  "excluded",
]);

export const doctorSupplySourceTypeEnum = pgEnum(
  "doctor_supply_source_type",
  [
    "consumable",
    "stent",
    "equipment",
    "manual",
  ],
);
const userReference = (name: string) =>
  uuid(name).references(() => users.id, {
    onDelete: "restrict",
    onUpdate: "cascade",
  });

export const workFormTemplates = pgTable(
  "work_form_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operationType: operationTypeEnum("operation_type").notNull(),
    name: varchar("name", { length: 150 }).notNull(),
    version: integer("version").notNull(),
    status: workFormTemplateStatusEnum("status").default("draft").notNull(),
    basedOnTemplateId: uuid("based_on_template_id"),
    createdByUserId: userReference("created_by_user_id"),
    updatedByUserId: userReference("updated_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("work_form_templates_type_version_unique").on(
      table.operationType,
      table.version,
    ),
    uniqueIndex("work_form_templates_one_published_per_type")
      .on(table.operationType)
      .where(sql`${table.status} = 'published'`),
    uniqueIndex("work_form_templates_one_draft_per_type")
      .on(table.operationType)
      .where(sql`${table.status} = 'draft'`),
    index("work_form_templates_status_idx").on(table.status),
    foreignKey({
      name: "work_form_templates_based_on_fk",
      columns: [table.basedOnTemplateId],
      foreignColumns: [table.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    check("work_form_templates_version_positive", sql`${table.version} > 0`),
    check(
      "work_form_templates_published_at_check",
      sql`(${table.status} = 'published' and ${table.publishedAt} is not null) or ${table.status} <> 'published'`,
    ),
  ],
);

export const workFormSections = pgTable(
  "work_form_sections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => workFormTemplates.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    stableKey: varchar("stable_key", { length: 100 }).notNull(),
    label: varchar("label", { length: 180 }).notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull(),
    isSystemSection: boolean("is_system_section").default(false).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("work_form_sections_template_key_unique").on(
      table.templateId,
      table.stableKey,
    ),
    uniqueIndex("work_form_sections_template_order_unique").on(
      table.templateId,
      table.sortOrder,
    ),
    check("work_form_sections_sort_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
);

export const workFormFields = pgTable(
  "work_form_fields",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => workFormTemplates.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => workFormSections.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    stableKey: varchar("stable_key", { length: 100 }).notNull(),
    label: varchar("label", { length: 180 }).notNull(),
    description: text("description"),
    fieldType: workFormFieldTypeEnum("field_type").notNull(),
    required: boolean("required").default(false).notNull(),
    multiple: boolean("multiple").default(false).notNull(),
    sortOrder: integer("sort_order").notNull(),
    isSystemField: boolean("is_system_field").default(false).notNull(),
    smartDropdownSource: workFormReferenceSourceEnum("smart_dropdown_source"),
    minSelections: integer("min_selections"),
    maxSelections: integer("max_selections"),
    showInForm: boolean("show_in_form").default(true).notNull(),
    showInDetails: boolean("show_in_details").default(true).notNull(),
    showInFinancialReview: boolean("show_in_financial_review")
      .default(false)
      .notNull(),
    reviewRole: workFormReviewRoleEnum("review_role").default("hidden").notNull(),
    showInPrint: boolean("show_in_print").default(false).notNull(),
    isFinancial: boolean("is_financial").default(false).notNull(),
    financialEffect: workFormFinancialEffectEnum("financial_effect"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("work_form_fields_template_key_unique").on(
      table.templateId,
      table.stableKey,
    ),
    uniqueIndex("work_form_fields_section_order_unique").on(
      table.sectionId,
      table.sortOrder,
    ),
    index("work_form_fields_template_idx").on(table.templateId),
    check("work_form_fields_sort_nonnegative", sql`${table.sortOrder} >= 0`),
    check(
      "work_form_fields_selection_bounds",
      sql`(${table.minSelections} is null or ${table.minSelections} >= 0) and (${table.maxSelections} is null or ${table.maxSelections} >= coalesce(${table.minSelections}, 0))`,
    ),
    check(
      "work_form_fields_financial_effect_check",
      sql`(${table.isFinancial} and ${table.financialEffect} is not null) or (not ${table.isFinancial} and ${table.financialEffect} is null)`,
    ),
  ],
);

export const lithotripsySessions = pgTable(
  "lithotripsy_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionNumber: integer("session_number").notNull(),
    name: varchar("name", { length: 180 }).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    active: boolean("active").default(true).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdByUserId: userReference("created_by_user_id").notNull(),
    updatedByUserId: userReference("updated_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("lithotripsy_sessions_number_unique").on(table.sessionNumber),
    index("lithotripsy_sessions_active_order_idx").on(table.active, table.sortOrder),
    check("lithotripsy_sessions_number_positive", sql`${table.sessionNumber} > 0`),
    check("lithotripsy_sessions_order_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
);

export const operations = pgTable(
  "operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: operationTypeEnum("type").notNull(),
    status: operationStatusEnum("status").default("recorded").notNull(),
    operationDate: date("operation_date", { mode: "string" }).notNull(),
    dailySequence: integer("daily_sequence").notNull(),
    operationTime: varchar("operation_time", { length: 5 }).notNull(),
    caseName: varchar("case_name", { length: 250 }).notNull(),
    doctorId: uuid("doctor_id").references(() => doctors.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    hospitalId: uuid("hospital_id").references(() => hospitals.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    contractEntityId: uuid("contract_entity_id").references(
      () => contractEntities.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    referenceNumber: varchar("reference_number", { length: 150 }),
    diagnosis: text("diagnosis"),
    notes: text("notes"),
    side: operationSideEnum("side"),
    anesthesiaType: varchar("anesthesia_type", { length: 120 }),
    anesthesiologistId: uuid("anesthesiologist_id").references(
      () => anesthesiologists.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    technicianId: uuid("technician_id").references(() => technicians.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    sessionCount: integer("session_count").default(1).notNull(),
    lithotripsySessionId: uuid("lithotripsy_session_id").references(() => lithotripsySessions.id, { onDelete: "restrict", onUpdate: "cascade" }),
    operationalAmountReceived: numeric("operational_amount_received", {
      precision: 12,
      scale: 2,
      mode: "number",
    }),
    formTemplateId: uuid("form_template_id").references(
      () => workFormTemplates.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    createdByUserId: userReference("created_by_user_id").notNull(),
    updatedByUserId: userReference("updated_by_user_id").notNull(),
    cancelledByUserId: userReference("cancelled_by_user_id"),
    cancellationReason: text("cancellation_reason"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("operations_daily_sequence_unique").on(
      table.operationDate,
      table.dailySequence,
    ),
    index("operations_date_idx").on(table.operationDate),
    index("operations_doctor_idx").on(table.doctorId),
    index("operations_hospital_idx").on(table.hospitalId),
    index("operations_type_status_idx").on(table.type, table.status),
    index("operations_created_by_idx").on(table.createdByUserId),
    index("operations_form_template_idx").on(table.formTemplateId),
    index("operations_lithotripsy_session_idx").on(table.lithotripsySessionId),
    check("operations_session_count_positive", sql`${table.sessionCount} > 0`),
    check(
      "operations_operational_amount_nonnegative",
      sql`${table.operationalAmountReceived} is null or ${table.operationalAmountReceived} >= 0`,
    ),
  ],
);

export const operationFieldValues = pgTable(
  "operation_field_values",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operationId: uuid("operation_id")
      .notNull()
      .references(() => operations.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    fieldId: uuid("field_id")
      .notNull()
      .references(() => workFormFields.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    textValue: text("text_value"),
    numberValue: numeric("number_value", { precision: 18, scale: 4 }),
    moneyValue: numeric("money_value", { precision: 14, scale: 2 }),
    dateValue: date("date_value", { mode: "string" }),
    timeValue: varchar("time_value", { length: 5 }),
    booleanValue: boolean("boolean_value"),
    referenceId: uuid("reference_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("operation_field_values_operation_field_unique").on(
      table.operationId,
      table.fieldId,
    ),
    index("operation_field_values_field_idx").on(table.fieldId),
    check(
      "operation_field_values_exactly_one_value",
      sql`num_nonnulls(${table.textValue}, ${table.numberValue}, ${table.moneyValue}, ${table.dateValue}, ${table.timeValue}, ${table.booleanValue}, ${table.referenceId}) = 1`,
    ),
  ],
);

export const operationFieldReferenceValues = pgTable(
  "operation_field_reference_values",
  {
    operationId: uuid("operation_id")
      .notNull()
      .references(() => operations.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    fieldId: uuid("field_id")
      .notNull()
      .references(() => workFormFields.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    referenceId: uuid("reference_id").notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.operationId, table.fieldId, table.referenceId],
    }),
    uniqueIndex("operation_field_reference_values_order_unique").on(
      table.operationId,
      table.fieldId,
      table.sortOrder,
    ),
    index("operation_field_reference_values_field_idx").on(table.fieldId),
    check(
      "operation_field_reference_values_sort_nonnegative",
      sql`${table.sortOrder} >= 0`,
    ),
  ],
);

export const operationProcedures = pgTable(
  "operation_procedures",
  {
    operationId: uuid("operation_id")
      .notNull()
      .references(() => operations.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    procedureId: uuid("procedure_id")
      .notNull()
      .references(() => procedures.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
  },
  (table) => [primaryKey({ columns: [table.operationId, table.procedureId] })],
);
export const operationEquipment = pgTable(
  "operation_equipment",
  {
    operationId: uuid("operation_id")
      .notNull()
      .references(() => operations.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    equipmentId: uuid("equipment_id")
      .notNull()
      .references(() => equipment.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
  },
  (table) => [primaryKey({ columns: [table.operationId, table.equipmentId] })],
);
export const operationConsumables = pgTable(
  "operation_consumables",
  {
    operationId: uuid("operation_id")
      .notNull()
      .references(() => operations.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    consumableId: uuid("consumable_id")
      .notNull()
      .references(() => consumables.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    quantity: numeric("quantity", { precision: 10, scale: 2, mode: "number" })
      .default(1)
      .notNull(),
    notes: text("notes"),
  },
  (table) => [
    primaryKey({ columns: [table.operationId, table.consumableId] }),
    check(
      "operation_consumables_quantity_positive",
      sql`${table.quantity} > 0`,
    ),
  ],
);
export const operationStents = pgTable(
  "operation_stents",
  {
    operationId: uuid("operation_id").notNull().references(() => operations.id, { onDelete: "cascade", onUpdate: "cascade" }),
    stentId: uuid("stent_id").notNull().references(() => stents.id, { onDelete: "restrict", onUpdate: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.operationId, table.stentId] }),
    index("operation_stents_operation_idx").on(table.operationId),
  ],
);
export const operationParticipants = pgTable(
  "operation_participants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operationId: uuid("operation_id")
      .notNull()
      .references(() => operations.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    role: participantRoleEnum("role").notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    linkedUserId: uuid("linked_user_id").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
  },
  (table) => [
    index("operation_participants_operation_idx").on(table.operationId),
  ],
);

export const operationFinancialReviews = pgTable(
  "operation_financial_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operationId: uuid("operation_id")
      .notNull()
      .references(() => operations.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    status: reviewStatusEnum("status").default("awaiting_review").notNull(),
    accountingMode: financialReviewAccountingModeEnum("accounting_mode").default("main_amount").notNull(),
    mainAmount: numeric("main_amount", {
      precision: 12,
      scale: 2,
      mode: "number",
    })
      .default(0)
      .notNull(),
    doctorAccountAmount: numeric("doctor_account_amount", {
      precision: 12,
      scale: 2,
      mode: "number",
    })
      .default(0)
      .notNull(),
    doctorBalanceReceived: boolean("doctor_balance_received")
      .default(false)
      .notNull(),
    doctorReceivedAmount: numeric("doctor_received_amount", {
      precision: 12,
      scale: 2,
      mode: "number",
    }),
    notes: text("notes"),
    reviewedByUserId: userReference("reviewed_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("operation_financial_reviews_operation_unique").on(
      table.operationId,
    ),
    check(
      "financial_review_amounts_nonnegative",
      sql`${table.mainAmount} >= 0`,
    ),
    check("financial_review_received_nonnegative", sql`${table.doctorReceivedAmount} is null or ${table.doctorReceivedAmount} >= 0`),
  ],
);
export const financialReviewDefinitions = pgTable(
  "financial_review_definitions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operationType: operationTypeEnum("operation_type").notNull(),
    stableKey: varchar("stable_key", { length: 100 }).notNull(),
    label: varchar("label", { length: 180 }).notNull(),
    kind: financialReviewDefinitionKindEnum("kind").notNull(),
    effect: workFormFinancialEffectEnum("effect").default("subtract").notNull(),
    sourceFieldStableKey: varchar("source_field_stable_key", { length: 100 }),
    sortOrder: integer("sort_order").default(0).notNull(),
    active: boolean("active").default(true).notNull(),
    visible: boolean("visible").default(true).notNull(),
    width: varchar("width", { length: 20 }).default("medium").notNull(),
    protected: boolean("protected").default(false).notNull(),
    createdByUserId: userReference("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("financial_review_definitions_type_key_unique").on(table.operationType, table.stableKey),
    index("financial_review_definitions_type_idx").on(table.operationType, table.active),
  ],
);
/** Lithotripsy-only reusable default prices. Case amounts remain in operation_financial_items. */
export const lithotripsyPricingDefinitions = pgTable(
  "lithotripsy_pricing_definitions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stableKey: varchar("stable_key", { length: 120 }).notNull().unique(),
    label: varchar("label", { length: 180 }).notNull(),
    category: varchar("category", { length: 40 }).notNull(),
    sourceType: varchar("source_type", { length: 60 }),
    sourceReferenceId: uuid("source_reference_id"),
    sessionValue: integer("session_value"),
    defaultAmount: numeric("default_amount", { precision: 12, scale: 2 }),
    effect: workFormFinancialEffectEnum("effect").default("subtract").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    active: boolean("active").default(true).notNull(),
    createdByUserId: userReference("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("litho_pricing_active_idx").on(table.active, table.sortOrder)],
);
export const lithotripsyPricingProfiles = pgTable(
  "lithotripsy_pricing_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 180 }).notNull(),
    normalizedName: varchar("normalized_name", { length: 180 }).notNull(),
    procedureSetKey: varchar("procedure_set_key", { length: 2000 }).notNull(),
    sessionNumber: integer("session_number"),
    sessionId: uuid("session_id").references(() => lithotripsySessions.id, { onDelete: "restrict", onUpdate: "cascade" }),
    isBase: boolean("is_base").default(false).notNull(),
    active: boolean("active").default(true).notNull(),
    version: integer("version").default(1).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdByUserId: userReference("created_by_user_id").notNull(),
    updatedByUserId: userReference("updated_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("litho_pricing_profiles_active_session_id_set_unique")
      .on(table.sessionId, table.procedureSetKey)
      .where(sql`${table.active} = true and ${table.archivedAt} is null and ${table.sessionId} is not null`),
    uniqueIndex("litho_pricing_profiles_active_number_compat_set_unique")
      .on(table.sessionNumber, table.procedureSetKey)
      .where(sql`${table.active} = true and ${table.archivedAt} is null and ${table.sessionId} is null and ${table.sessionNumber} is not null`),
    uniqueIndex("litho_pricing_profiles_active_legacy_set_unique")
      .on(table.procedureSetKey)
      .where(sql`${table.active} = true and ${table.archivedAt} is null and ${table.sessionNumber} is null`),
    uniqueIndex("litho_pricing_profiles_active_session_id_base_unique")
      .on(table.sessionId)
      .where(sql`${table.active} = true and ${table.archivedAt} is null and ${table.isBase} = true and ${table.sessionId} is not null`),
    uniqueIndex("litho_pricing_profiles_active_number_compat_base_unique")
      .on(table.sessionNumber)
      .where(sql`${table.active} = true and ${table.archivedAt} is null and ${table.isBase} = true and ${table.sessionId} is null and ${table.sessionNumber} is not null`),
    uniqueIndex("litho_pricing_profiles_active_legacy_base_unique")
      .on(table.isBase)
      .where(sql`${table.active} = true and ${table.archivedAt} is null and ${table.isBase} = true and ${table.sessionNumber} is null`),
    index("litho_pricing_profiles_active_sort_idx").on(table.active, table.sortOrder),
    check("litho_pricing_profiles_session_number_check", sql`${table.sessionNumber} is null or ${table.sessionNumber} > 0`),
  ],
);
export const lithotripsyPricingProfileProcedures = pgTable(
  "lithotripsy_pricing_profile_procedures",
  {
    profileId: uuid("profile_id").notNull().references(() => lithotripsyPricingProfiles.id, { onDelete: "restrict", onUpdate: "cascade" }),
    procedureId: uuid("procedure_id").notNull().references(() => procedures.id, { onDelete: "restrict", onUpdate: "cascade" }),
    sortOrder: integer("sort_order").default(0).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.procedureId] }),
    index("litho_pricing_profile_procedures_procedure_idx").on(table.procedureId),
  ],
);
export const lithotripsyPricingProfileLines = pgTable(
  "lithotripsy_pricing_profile_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    profileId: uuid("profile_id").notNull().references(() => lithotripsyPricingProfiles.id, { onDelete: "restrict", onUpdate: "cascade" }),
    pricingDefinitionId: uuid("pricing_definition_id").references(() => lithotripsyPricingDefinitions.id, { onDelete: "restrict", onUpdate: "cascade" }),
    stableKey: varchar("stable_key", { length: 120 }).notNull(),
    lineType: lithotripsyPricingProfileLineTypeEnum("line_type").notNull(),
    label: varchar("label", { length: 180 }).notNull(),
    defaultAmount: numeric("default_amount", { precision: 12, scale: 2 }),
    effect: workFormFinancialEffectEnum("effect").default("subtract").notNull(),
    sourceType: varchar("source_type", { length: 60 }),
    sourceReferenceId: uuid("source_reference_id"),
    sessionValue: integer("session_value"),
    sortOrder: integer("sort_order").default(0).notNull(),
    active: boolean("active").default(true).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdByUserId: userReference("created_by_user_id").notNull(),
    updatedByUserId: userReference("updated_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("litho_pricing_profile_lines_profile_key_unique").on(table.profileId, table.stableKey),
    index("litho_pricing_profile_lines_profile_sort_idx").on(table.profileId, table.active, table.sortOrder),
  ],
);

/** Hospital-scoped Contract and global Endoscopy default price libraries. */
export const servicePricingProfiles = pgTable(
  "service_pricing_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operationType: operationTypeEnum("operation_type").notNull(),
    hospitalId: uuid("hospital_id").references(() => hospitals.id, { onDelete: "restrict", onUpdate: "cascade" }),
    name: varchar("name", { length: 180 }).notNull(),
    version: integer("version").default(1).notNull(),
    active: boolean("active").default(true).notNull(),
    notes: text("notes"),
    createdByUserId: userReference("created_by_user_id").notNull(),
    updatedByUserId: userReference("updated_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    index("service_pricing_profiles_domain_idx").on(table.operationType, table.active),
    check("service_pricing_profiles_scope_check", sql`(${table.operationType} = 'contract' and ${table.hospitalId} is not null) or (${table.operationType} = 'endoscopy' and ${table.hospitalId} is null)`),
    check("service_pricing_profiles_domain_check", sql`${table.operationType} in ('contract','endoscopy')`),
  ],
);

export const servicePricingItems = pgTable(
  "service_pricing_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    profileId: uuid("profile_id").notNull().references(() => servicePricingProfiles.id, { onDelete: "restrict", onUpdate: "cascade" }),
    stableKey: varchar("stable_key", { length: 180 }).notNull(),
    sourceType: financialItemSourceTypeEnum("source_type").notNull(),
    sourceReferenceId: uuid("source_reference_id"),
    label: varchar("label", { length: 220 }).notNull(),
    defaultAmount: numeric("default_amount", { precision: 12, scale: 2, mode: "number" }),
    effect: workFormFinancialEffectEnum("effect").default("subtract").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    active: boolean("active").default(true).notNull(),
    notes: text("notes"),
    createdByUserId: userReference("created_by_user_id").notNull(),
    updatedByUserId: userReference("updated_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    index("service_pricing_items_profile_idx").on(table.profileId, table.active, table.sortOrder),
    uniqueIndex("service_pricing_items_active_key_unique").on(table.profileId, table.stableKey).where(sql`${table.active} = true`),
  ],
);
export const operationFinancialItems = pgTable(
  "operation_financial_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => operationFinancialReviews.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    catalogItemId: uuid("catalog_item_id").references(
      () => financialItemCatalog.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    definitionId: uuid("definition_id").references(() => financialReviewDefinitions.id, { onDelete: "restrict", onUpdate: "cascade" }),
    kind: operationFinancialItemKindEnum("kind").notNull(),
    description: varchar("description", { length: 250 }).notNull(),
    amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }),
    baseAmount: numeric("base_amount", { precision: 12, scale: 2, mode: "number" }),
    adjustmentAmount: numeric("adjustment_amount", { precision: 12, scale: 2, mode: "number" }),
    effectiveAmount: numeric("effective_amount", { precision: 12, scale: 2, mode: "number" }),
    caseLineState: operationFinancialLineStateEnum("case_line_state").default("included").notNull(),
    financialEffect: workFormFinancialEffectEnum("financial_effect")
      .default("add")
      .notNull(),
    sourceType: financialItemSourceTypeEnum("source_type")
      .default("manual")
      .notNull(),
    sourceFieldId: uuid("source_field_id").references(() => workFormFields.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    sourceReferenceId: uuid("source_reference_id"),
    pricingProfileId: uuid("pricing_profile_id").references(() => lithotripsyPricingProfiles.id, { onDelete: "restrict", onUpdate: "cascade" }),
    pricingProfileLineId: uuid("pricing_profile_line_id").references(() => lithotripsyPricingProfileLines.id, { onDelete: "restrict", onUpdate: "cascade" }),
    pricingProfileVersion: integer("pricing_profile_version"),
    servicePricingProfileId: uuid("service_pricing_profile_id").references(() => servicePricingProfiles.id, { onDelete: "restrict", onUpdate: "cascade" }),
    servicePricingItemId: uuid("service_pricing_item_id").references(() => servicePricingItems.id, { onDelete: "restrict", onUpdate: "cascade" }),
    servicePricingVersion: integer("service_pricing_version"),
    notes: text("notes"),
    createdByUserId: userReference("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("operation_financial_items_review_idx").on(table.reviewId),
    uniqueIndex("operation_financial_items_source_unique")
      .on(
        table.reviewId,
        table.sourceType,
        table.sourceFieldId,
        table.sourceReferenceId,
      )
      .where(sql`${table.sourceType} not in ('manual','other')`),
    check(
      "operation_financial_item_kind_amount",
      sql`(${table.kind} = 'note' and ${table.amount} is null and ${table.financialEffect} = 'neutral') or (${table.kind} = 'financial' and ${table.amount} >= 0)`,
    ),
    check("operation_financial_item_effective_nonnegative", sql`${table.effectiveAmount} is null or ${table.effectiveAmount} >= 0`),
    check("operation_financial_item_base_nonnegative", sql`${table.baseAmount} is null or ${table.baseAmount} >= 0`),
    check("operation_financial_item_adjustment_consistent", sql`${table.baseAmount} is null or ${table.adjustmentAmount} is null or ${table.effectiveAmount} = ${table.baseAmount} + ${table.adjustmentAmount}`),
  ],
);
export const operationFinancialPayments = pgTable(
  "operation_financial_payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => operationFinancialReviews.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    amount: numeric("amount", {
      precision: 12,
      scale: 2,
      mode: "number",
    }).notNull(),
    notes: text("notes"),
    paidAt: timestamp("paid_at", { withTimezone: true }).defaultNow().notNull(),
    createdByUserId: userReference("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("operation_financial_payments_review_idx").on(table.reviewId),
    check("operation_financial_payment_positive", sql`${table.amount} > 0`),
  ],
);
export const doctorAccountPostings = pgTable(
  "doctor_account_postings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operationId: uuid("operation_id")
      .notNull()
      .references(() => operations.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => operationFinancialReviews.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctors.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    amount: numeric("amount", {
      precision: 12,
      scale: 2,
      mode: "number",
    }).notNull(),
    direction: varchar("direction", { length: 16 }).default("debit").notNull(),
    caseNameSnapshot: varchar("case_name_snapshot", { length: 250 }),
    operationTypeSnapshot: operationTypeEnum("operation_type_snapshot"),
    doctorNameSnapshot: varchar("doctor_name_snapshot", { length: 200 }),
    referenceAmountSnapshot: numeric("reference_amount_snapshot", {
      precision: 12,
      scale: 2,
      mode: "number",
    }),
    differenceAmountSnapshot: numeric("difference_amount_snapshot", {
      precision: 12,
      scale: 2,
      mode: "number",
    }),
    postedByUserId: userReference("posted_by_user_id").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    reversed: boolean("reversed").default(false).notNull(),
  },
  (table) => [
    uniqueIndex("doctor_account_postings_operation_unique").on(
      table.operationId,
    ),
    index("doctor_account_postings_doctor_idx").on(table.doctorId),
    check(
      "doctor_account_posting_amount_nonnegative",
      sql`${table.amount} >= 0`,
    ),
    check(
      "doctor_account_posting_direction_valid",
      sql`${table.direction} in ('debit','credit')`,
    ),
  ],
);

export const doctorAccountAdjustments = pgTable(
  "doctor_account_adjustments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    doctorId: uuid("doctor_id").notNull().references(() => doctors.id, { onDelete: "restrict", onUpdate: "cascade" }),
    direction: varchar("direction", { length: 16 }).notNull(),
    amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    description: varchar("description", { length: 240 }).notNull(),
    notes: text("notes"),
    idempotencyKey: varchar("idempotency_key", { length: 100 }).notNull(),
    createdByUserId: userReference("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    reversed: boolean("reversed").default(false).notNull(),
  },
  (table) => [
    uniqueIndex("doctor_account_adjustments_idempotency_unique").on(table.idempotencyKey),
    index("doctor_account_adjustments_doctor_idx").on(table.doctorId, table.occurredAt),
    check("doctor_account_adjustment_direction_valid", sql`${table.direction} in ('debit','credit')`),
    check("doctor_account_adjustment_amount_positive", sql`${table.amount} > 0`),
  ],
);

export const doctorPayments = pgTable(
  "doctor_payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    doctorId: uuid("doctor_id").notNull().references(() => doctors.id, { onDelete: "restrict", onUpdate: "cascade" }),
    amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
    notes: text("notes"),
    idempotencyKey: varchar("idempotency_key", { length: 100 }).notNull(),
    createdByUserId: userReference("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    reversed: boolean("reversed").default(false).notNull(),
  },
  (table) => [
    uniqueIndex("doctor_payments_idempotency_unique").on(table.idempotencyKey),
    index("doctor_payments_doctor_idx").on(table.doctorId, table.paidAt),
    check("doctor_payment_amount_positive", sql`${table.amount} > 0`),
  ],
);

export const doctorSupplyIssues = pgTable(
  "doctor_supply_issues",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctors.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),

    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
    }).notNull(),

    notes: text("notes"),

    idempotencyKey: varchar("idempotency_key", {
      length: 120,
    }).notNull(),

    reversed: boolean("reversed")
      .default(false)
      .notNull(),

    createdByUserId: userReference(
      "created_by_user_id",
    ).notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex(
      "doctor_supply_issues_idempotency_unique",
    ).on(table.idempotencyKey),

    index(
      "doctor_supply_issues_doctor_idx",
    ).on(table.doctorId),

    index(
      "doctor_supply_issues_occurred_at_idx",
    ).on(table.occurredAt),

    index(
      "doctor_supply_issues_doctor_occurred_at_idx",
    ).on(
      table.doctorId,
      table.occurredAt,
    ),
  ],
);

export const doctorSupplyIssueItems = pgTable(
  "doctor_supply_issue_items",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    issueId: uuid("issue_id")
      .notNull()
      .references(() => doctorSupplyIssues.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),

    sourceType:
      doctorSupplySourceTypeEnum(
        "source_type",
      ).notNull(),

    sourceReferenceId: uuid(
      "source_reference_id",
    ),

    itemNameSnapshot: varchar(
      "item_name_snapshot",
      {
        length: 240,
      },
    ).notNull(),

    quantity: numeric("quantity", {
      precision: 12,
      scale: 2,
      mode: "number",
    }).notNull(),

    unitPrice: numeric("unit_price", {
      precision: 12,
      scale: 2,
      mode: "number",
    }).notNull(),

    totalAmount: numeric("total_amount", {
      precision: 14,
      scale: 2,
      mode: "number",
    }).notNull(),

    sortOrder: integer("sort_order")
      .default(0)
      .notNull(),

    notes: text("notes"),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index(
      "doctor_supply_issue_items_issue_idx",
    ).on(table.issueId),

    index(
      "doctor_supply_issue_items_source_idx",
    ).on(
      table.sourceType,
      table.sourceReferenceId,
    ),

    index(
      "doctor_supply_issue_items_issue_sort_idx",
    ).on(
      table.issueId,
      table.sortOrder,
    ),

    check(
      "doctor_supply_issue_items_quantity_positive",
      sql`${table.quantity} > 0`,
    ),

    check(
      "doctor_supply_issue_items_unit_price_nonnegative",
      sql`${table.unitPrice} >= 0`,
    ),

    check(
      "doctor_supply_issue_items_total_nonnegative",
      sql`${table.totalAmount} >= 0`,
    ),

    check(
      "doctor_supply_issue_items_sort_order_nonnegative",
      sql`${table.sortOrder} >= 0`,
    ),

    check(
      "doctor_supply_issue_items_source_reference_check",
      sql`
        (
          ${table.sourceType} = 'manual'
        )
        or
        (
          ${table.sourceType} <> 'manual'
          and
          ${table.sourceReferenceId} is not null
        )
      `,
    ),
  ],
);
