import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sessions, users } from "./auth";
import { operations } from "./operations";

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("push_subscriptions_endpoint_unique").on(table.endpoint),
  index("push_subscriptions_user_id_idx").on(table.userId),
  index("push_subscriptions_session_id_idx").on(table.sessionId),
]);

export const pushDispatchClaims = pgTable("push_dispatch_claims", {
  id: uuid("id").defaultRandom().primaryKey(),
  operationId: uuid("operation_id").notNull().references(() => operations.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("push_dispatch_claims_operation_event_unique").on(table.operationId, table.eventType),
]);
