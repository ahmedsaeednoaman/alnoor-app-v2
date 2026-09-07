import {
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/* =========================================================
   ENUMS
   ========================================================= */

export const userStatusEnum = pgEnum("user_status", [
  "active",
  "suspended",
  "blocked",
]);

export const permissionOverrideEffectEnum = pgEnum(
  "permission_override_effect",
  ["grant", "deny"],
);

/* =========================================================
   ROLES
   ========================================================= */

/**
 * الـ Role أصبح Template افتراضي فقط.
 *
 * أمثلة:
 * owner
 * accountant
 * employee
 *
 * الصلاحيات نفسها لم تعد مخزنة JSON هنا.
 */
export const roles = pgTable(
  "roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    code: varchar("code", {
      length: 50,
    }).notNull(),

    name: varchar("name", {
      length: 100,
    }).notNull(),

    description: text("description"),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("roles_code_unique").on(table.code)],
);

/* =========================================================
   PERMISSIONS
   ========================================================= */

/**
 * المصدر المركزي لكل Permission في النظام.
 *
 * مثال:
 *
 * code:
 * operations.create
 *
 * module:
 * operations
 *
 * label:
 * إضافة شغل
 */
export const permissions = pgTable(
  "permissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    code: varchar("code", {
      length: 100,
    }).notNull(),

    module: varchar("module", {
      length: 50,
    }).notNull(),

    label: varchar("label", {
      length: 150,
    }).notNull(),

    description: text("description"),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("permissions_code_unique").on(table.code)],
);

/* =========================================================
   ROLE PERMISSIONS
   ========================================================= */

/**
 * الصلاحيات الافتراضية التي يمنحها الـRole.
 *
 * مثال:
 *
 * employee
 *   -> operations.view
 *   -> operations.create
 *   -> expenses.create
 *
 * accountant
 *   -> accounting.review
 *   -> doctor_accounts.view
 */
export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),

    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "role_permissions_pk",

      columns: [table.roleId, table.permissionId],
    }),
  ],
);

/* =========================================================
   USERS
   ========================================================= */

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    username: varchar("username", {
      length: 80,
    }).notNull(),

    passwordHash: text("password_hash").notNull(),

    displayName: varchar("display_name", {
      length: 150,
    }).notNull(),

    status: userStatusEnum("status").default("active").notNull(),

    /**
     * الـRole الأساسي أصبح Template.
     *
     * الصلاحية النهائية =
     * Role permissions
     * +
     * User grants
     * -
     * User denies
     */
    baseRoleId: uuid("base_role_id")
      .notNull()
      .references(() => roles.id, {
        onDelete: "restrict",

        onUpdate: "cascade",
      }),

    lastLoginAt: timestamp("last_login_at", {
      withTimezone: true,
    }),

    archivedAt: timestamp("archived_at", {
      withTimezone: true,
    }),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("users_username_unique").on(table.username)],
);

/* =========================================================
   USER PERMISSION OVERRIDES
   ========================================================= */

/**
 * دي أهم جزئية للـMixed Account.
 *
 * grant:
 * أضف للمستخدم Permission ليست موجودة
 * في الـBase Role.
 *
 * deny:
 * امنع Permission حتى لو الـRole
 * الأساسي يمنحها.
 */
export const userPermissionOverrides = pgTable(
  "user_permission_overrides",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",

        onUpdate: "cascade",
      }),

    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, {
        onDelete: "cascade",

        onUpdate: "cascade",
      }),

    effect: permissionOverrideEffectEnum("effect").notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "user_permission_overrides_pk",

      columns: [table.userId, table.permissionId],
    }),
  ],
);

/* =========================================================
   SESSIONS
   ========================================================= */

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
      }),

    tokenHash: varchar("token_hash", {
      length: 64,
    }).notNull(),

    expiresAt: timestamp("expires_at", {
      withTimezone: true,
    }).notNull(),

    revokedAt: timestamp("revoked_at", {
      withTimezone: true,
    }),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("sessions_token_hash_unique").on(table.tokenHash)],
);
