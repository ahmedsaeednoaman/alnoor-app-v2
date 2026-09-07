import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
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

export const reimbursementStatusEnum = pgEnum("reimbursement_status", [
  "unpaid",
  "paid",
]);

export const expenseCategories = pgTable(
  "expense_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    normalizedName: varchar("normalized_name", { length: 120 }).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("expense_categories_normalized_name_unique").on(
      table.normalizedName,
    ),
    index("expense_categories_active_name_idx").on(
      table.isActive,
      table.normalizedName,
    ),
  ],
);

export const companyExpenses = pgTable(
  "company_expenses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    employeeNameSnapshot: varchar("employee_name_snapshot", {
      length: 150,
    }).notNull(),
    expenseDate: date("expense_date", { mode: "string" }).notNull(),
    expenseTime: varchar("expense_time", { length: 5 }).notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => expenseCategories.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    categoryNameSnapshot: varchar("category_name_snapshot", {
      length: 120,
    }).notNull(),
    description: varchar("description", { length: 500 }).notNull(),
    notes: text("notes"),
    idempotencyKey: varchar("idempotency_key", { length: 120 }).notNull(),
    reimbursementStatus: reimbursementStatusEnum("reimbursement_status")
      .default("unpaid")
      .notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paidByUserId: uuid("paid_by_user_id").references(() => users.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("company_expenses_idempotency_key_unique").on(
      table.idempotencyKey,
    ),
    index("company_expenses_date_creator_idx").on(
      table.expenseDate.desc(),
      table.createdByUserId,
    ),
    index("company_expenses_creator_idx").on(table.createdByUserId),
    index("company_expenses_category_idx").on(table.categoryId),
    index("company_expenses_status_date_idx").on(
      table.reimbursementStatus,
      table.expenseDate.desc(),
    ),
    check("company_expenses_amount_positive", sql`${table.amount} > 0`),
    check(
      "company_expenses_time_valid",
      sql`${table.expenseTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check(
      "company_expenses_paid_audit_valid",
      sql`(${table.reimbursementStatus} = 'unpaid' and ${table.paidAt} is null and ${table.paidByUserId} is null) or (${table.reimbursementStatus} = 'paid' and ${table.paidAt} is not null and ${table.paidByUserId} is not null)`,
    ),
  ],
);
