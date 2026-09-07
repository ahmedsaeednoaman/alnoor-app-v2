import * as argon2 from "argon2";

import {
  and,
  eq,
} from "drizzle-orm";

import {
  db,
  postgresClient,
} from "./client";

import {
  permissions,
  rolePermissions,
  roles,
  users,
} from "./schema";
import { bootstrapInitialWorkForms } from "../lib/work-forms/service";
import { accountantPermissions, employeePermissions, permissionCatalog } from "./rbac-definitions";

async function getOrCreateRole(
  code: string,
  name: string,
  description: string,
) {
  let [role] =
    await db
      .select()
      .from(roles)
      .where(
        eq(
          roles.code,
          code,
        ),
      )
      .limit(1);

  if (role) {
    return role;
  }

  [role] =
    await db
      .insert(roles)
      .values({
        code,
        name,
        description,
      })
      .returning();

  return role;
}

async function ensurePermissions() {
  for (
    const item
    of permissionCatalog
  ) {
    const [existing] =
      await db
        .select()
        .from(permissions)
        .where(
          eq(
            permissions.code,
            item.code,
          ),
        )
        .limit(1);

    if (existing) {
      continue;
    }

    await db
      .insert(permissions)
      .values({
        code:
          item.code,

        module:
          item.module,

        label:
          item.label,
      });
  }
}

async function assignPermissionsToRole(
  roleId: string,
  permissionCodes: readonly string[],
) {
  for (
    const code
    of permissionCodes
  ) {
    const [permission] =
      await db
        .select()
        .from(permissions)
        .where(
          eq(
            permissions.code,
            code,
          ),
        )
        .limit(1);

    if (!permission) {
      throw new Error(
        `Permission not found: ${code}`,
      );
    }

    const [existing] =
      await db
        .select()
        .from(
          rolePermissions,
        )
        .where(
          and(
            eq(
              rolePermissions.roleId,
              roleId,
            ),
            eq(
              rolePermissions.permissionId,
              permission.id,
            ),
          ),
        )
        .limit(1);

    if (existing) {
      continue;
    }

    await db
      .insert(
        rolePermissions,
      )
      .values({
        roleId,

        permissionId:
          permission.id,
      });
  }
}

async function main() {
  /* ========================================
     ENV
     ======================================== */

  const username = (
    process.env
      .BOOTSTRAP_OWNER_USERNAME ??
    "owner"
  )
    .trim()
    .toLowerCase();

  const displayName =
    process.env
      .BOOTSTRAP_OWNER_DISPLAY_NAME ??
    "مالك النظام";

  const password =
    process.env
      .BOOTSTRAP_OWNER_PASSWORD;

  if (!password) {
    throw new Error(
      "BOOTSTRAP_OWNER_PASSWORD is required",
    );
  }

  if (
    password.length < 12
  ) {
    throw new Error(
      "BOOTSTRAP_OWNER_PASSWORD must be at least 12 characters",
    );
  }

  /* ========================================
     PERMISSION CATALOG
     ======================================== */

  await ensurePermissions();

  /* ========================================
     ROLES
     ======================================== */

  const ownerRole = await getOrCreateRole("owner", "صاحب الشركة", "صلاحيات كاملة للنظام");

  const employeeRole = await getOrCreateRole("employee", "الموظف", "صلاحيات التشغيل الأساسية");

  const accountantRole = await getOrCreateRole("accountant", "المحاسب", "صلاحيات المراجعة والحسابات");

  /* ========================================
     ROLE PERMISSIONS
     ======================================== */

  /*
   * Owner يأخذ جميع الصلاحيات الموجودة.
   */
  await assignPermissionsToRole(
    ownerRole.id,
    permissionCatalog.map(
      (permission) =>
        permission.code,
    ),
  );

  await assignPermissionsToRole(
    employeeRole.id,
    employeePermissions,
  );

  await assignPermissionsToRole(
    accountantRole.id,
    accountantPermissions,
  );

  /* ========================================
     OWNER USER
     ======================================== */

  const [existingUser] =
    await db
      .select()
      .from(users)
      .where(
        eq(
          users.username,
          username,
        ),
      )
      .limit(1);

  let ownerId: string;
  if (existingUser) {
    /*
     * مهم:
     * حتى لو الـOwner موجود من قبل،
     * الـSeed لا يتوقف قبل إنشاء
     * Permissions / Role Permissions.
     */

    console.log(
      `Owner already exists: ${username}`,
    );

    ownerId = existingUser.id;
  } else {
    const passwordHash =
    await argon2.hash(
      password,
      {
        type:
          argon2.argon2id,
      },
    );

    const [owner] =
    await db
      .insert(users)
      .values({
        username,

        passwordHash,

        displayName,

        status:
          "active",

        baseRoleId:
          ownerRole.id,
      })
      .returning({
        id:
          users.id,

        username:
          users.username,

        displayName:
          users.displayName,
      });

    ownerId = owner.id;
    console.log("Owner created successfully:", owner);
  }
  await bootstrapInitialWorkForms(ownerId);
  console.log("Initial work-form templates verified.");
}

main()
  .catch(
    (error) => {
      console.error(
        error,
      );

      process.exitCode =
        1;
    },
  )
  .finally(
    async () => {
      await postgresClient.end();
    },
  );
