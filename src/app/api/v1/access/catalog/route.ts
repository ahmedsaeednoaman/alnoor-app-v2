import {
  randomUUID,
} from "node:crypto";

import {
  asc,
} from "drizzle-orm";

import {
  NextResponse,
} from "next/server";

import {
  db,
} from "@/db/client";

import {
  permissions,
  rolePermissions,
  roles,
} from "@/db/schema";

import {
  AuthenticationRequiredError,
  PermissionDeniedError,
  requireAnyPermission,
} from "@/lib/auth/guards";

export const runtime =
  "nodejs";

function apiError(
  status: number,
  code: string,
  message: string,
  requestId: string,
) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        requestId,
      },
    },
    {
      status,
    },
  );
}

export async function GET() {
  const requestId =
    randomUUID();

  try {
    /*
     * المستخدم الذي يستطيع عرض المستخدمين
     * يمكنه أيضًا رؤية الأدوار والكتالوج
     * المطلوب لواجهة Users.
     */
    await requireAnyPermission([
      "users.view",
      "settings.view",
    ]);

    /* ========================================
       ROLES
       ======================================== */

    const roleRows =
      await db
        .select({
          id:
            roles.id,

          code:
            roles.code,

          name:
            roles.name,

          description:
            roles.description,
        })
        .from(roles)
        .orderBy(
          asc(
            roles.name,
          ),
        );

    /* ========================================
       PERMISSIONS
       ======================================== */

    const permissionRows =
      await db
        .select({
          id:
            permissions.id,

          code:
            permissions.code,

          module:
            permissions.module,

          label:
            permissions.label,

          description:
            permissions.description,
        })
        .from(
          permissions,
        )
        .orderBy(
          asc(
            permissions.module,
          ),
          asc(
            permissions.label,
          ),
        );

    /* ========================================
       ROLE DEFAULT PERMISSIONS
       ======================================== */

    const rolePermissionRows =
      await db
        .select({
          roleId:
            rolePermissions.roleId,

          permissionId:
            rolePermissions.permissionId,
        })
        .from(
          rolePermissions,
        );

    const rolePermissionMap =
      new Map<
        string,
        string[]
      >();

    for (
      const item
      of rolePermissionRows
    ) {
      const current =
        rolePermissionMap.get(
          item.roleId,
        ) ?? [];

      current.push(
        item.permissionId,
      );

      rolePermissionMap.set(
        item.roleId,
        current,
      );
    }

    const rolesWithDefaults =
      roleRows.map(
        (role) => ({
          ...role,

          defaultPermissionIds:
            rolePermissionMap.get(
              role.id,
            ) ?? [],
        }),
      );

    /* ========================================
       GROUP PERMISSIONS BY MODULE
       ======================================== */

    const moduleMap =
      new Map<
        string,
        typeof permissionRows
      >();

    for (
      const permission
      of permissionRows
    ) {
      const current =
        moduleMap.get(
          permission.module,
        ) ?? [];

      current.push(
        permission,
      );

      moduleMap.set(
        permission.module,
        current,
      );
    }

    const modules =
      Array.from(
        moduleMap.entries(),
      ).map(
        ([
          module,
          modulePermissions,
        ]) => ({
          module,

          permissions:
            modulePermissions,
        }),
      );

    return NextResponse.json(
      {
        roles:
          rolesWithDefaults,

        permissions:
          permissionRows,

        modules,

        meta: {
          roleCount:
            roleRows.length,

          permissionCount:
            permissionRows.length,
        },
      },
      {
        status: 200,
      },
    );
  } catch (error) {
    if (
      error instanceof
      AuthenticationRequiredError
    ) {
      return apiError(
        401,
        "AUTHENTICATION_REQUIRED",
        "يجب تسجيل الدخول أولاً.",
        requestId,
      );
    }

    if (
      error instanceof
      PermissionDeniedError
    ) {
      return apiError(
        403,
        "PERMISSION_DENIED",
        "ليس لديك صلاحية لعرض الأدوار والصلاحيات.",
        requestId,
      );
    }

    console.error(
      "[ACCESS_CATALOG]",
      requestId,
      error,
    );

    return apiError(
      500,
      "INTERNAL_SERVER_ERROR",
      "حدث خطأ أثناء تحميل الأدوار والصلاحيات.",
      requestId,
    );
  }
}