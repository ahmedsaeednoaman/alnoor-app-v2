import { sql } from "drizzle-orm";
import { check, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { operations } from "./operations";
import { users } from "./auth";

export const operationTaxInvoices = pgTable("operation_tax_invoices", {
  id: uuid("id").defaultRandom().primaryKey(),
  operationId: uuid("operation_id").notNull().references(() => operations.id, { onDelete: "restrict" }),
  taxRegistry: varchar("tax_registry", { length: 10 }).notNull(),
  invoiceNumber: varchar("invoice_number", { length: 100 }).notNull(),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("operation_tax_invoices_operation_unique").on(table.operationId),
  check("operation_tax_invoices_registry_valid", sql`${table.taxRegistry} in ('alnoor', 'alkawthar')`),
  check("operation_tax_invoices_number_digits", sql`${table.invoiceNumber} ~ '^[0-9]+$'`),
]);
