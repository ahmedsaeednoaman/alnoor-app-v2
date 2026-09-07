import { eq } from "drizzle-orm";

import { db } from "@/db/client";

import {
  permissions,
  rolePermissions,
  userPermissionOverrides,
} from "@/db/schema";

type EffectivePermission = {
  code: string;
  module: string;
};

export type EffectiveAuthorization = {
  permissions: string[];
  allowedModules: string[];
};

export async function getEffectiveAuthorization(
  userId: string,
  baseRoleId: string,
): Promise<EffectiveAuthorization> {
  /*
   * 1. الصلاحيات الافتراضية من الـ Role.
   */
  const rolePermissionRows =
    await db
      .select({
        code: permissions.code,
        module: permissions.module,
      })
      .from(rolePermissions)
      .innerJoin(
        permissions,
        eq(
          permissions.id,
          rolePermissions.permissionId,
        ),
      )
      .where(
        eq(
          rolePermissions.roleId,
          baseRoleId,
        ),
      );

  /*
   * Map بدل Array عشان:
   * - يمنع التكرار.
   * - يسهل Grant / Deny.
   */
  const effective =
    new Map<
      string,
      EffectivePermission
    >();

  for (
    const permission
    of rolePermissionRows
  ) {
    effective.set(
      permission.code,
      permission,
    );
  }

  /*
   * 2. Overrides الخاصة بالمستخدم.
   */
  const overrideRows =
    await db
      .select({
        code: permissions.code,
        module: permissions.module,
        effect:
          userPermissionOverrides.effect,
      })
      .from(
        userPermissionOverrides,
      )
      .innerJoin(
        permissions,
        eq(
          permissions.id,
          userPermissionOverrides.permissionId,
        ),
      )
      .where(
        eq(
          userPermissionOverrides.userId,
          userId,
        ),
      );

  /*
   * 3. Apply user overrides.
   */
  for (
    const override
    of overrideRows
  ) {
    if (
      override.effect === "deny"
    ) {
      effective.delete(
        override.code,
      );

      continue;
    }

    effective.set(
      override.code,
      {
        code:
          override.code,

        module:
          override.module,
      },
    );
  }

  /*
   * 4. النتيجة النهائية.
   */
  const finalPermissions =
    Array.from(
      effective.values(),
    );

  const permissionCodes =
    finalPermissions
      .map(
        (permission) =>
          permission.code,
      )
      .sort();

  const allowedModules =
    Array.from(
      new Set(
        finalPermissions.map(
          (permission) =>
            permission.module,
        ),
      ),
    ).sort();

  return {
    permissions:
      permissionCodes,

    allowedModules,
  };
}