import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db/client";
import {
  permissions,
  rolePermissions,
  roles,
  userPermissionOverrides,
  users,
} from "@/db/schema";
import {
  AuthenticationRequiredError,
  PermissionDeniedError,
  requirePermission,
} from "@/lib/auth/guards";
import { getEffectiveAuthorization } from "@/lib/auth/permissions";

export const runtime = "nodejs";

const userIdSchema = z.string().uuid("معرف المستخدم غير صحيح.");

const permissionOverridesSchema = z
  .object({
    grants: z.array(z.string().min(1)).max(200),
    denies: z.array(z.string().min(1)).max(200),
  })
  .superRefine((value, context) => {
    if (new Set(value.grants).size !== value.grants.length) {
      context.addIssue({
        code: "custom",
        path: ["grants"],
        message: "تحتوي الصلاحيات المسموحة على قيم مكررة.",
      });
    }

    if (new Set(value.denies).size !== value.denies.length) {
      context.addIssue({
        code: "custom",
        path: ["denies"],
        message: "تحتوي الصلاحيات الممنوعة على قيم مكررة.",
      });
    }

    const grants = new Set(value.grants);

    if (value.denies.some((code) => grants.has(code))) {
      context.addIssue({
        code: "custom",
        message: "لا يمكن السماح بالصلاحية ومنعها في الوقت نفسه.",
      });
    }
  });

function apiError(
  status: number,
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        requestId,
        ...(details ? { details } : {}),
      },
    },
    { status },
  );
}

async function findUserAccess(userId: string) {
  const [user] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      archivedAt: users.archivedAt,
      baseRoleId: roles.id,
      baseRoleCode: roles.code,
      baseRoleName: roles.name,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.baseRoleId))
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return null;

  const [baseRows, overrideRows, effective] = await Promise.all([
    db
      .select({ code: permissions.code })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(rolePermissions.roleId, user.baseRoleId)),
    db
      .select({
        code: permissions.code,
        effect: userPermissionOverrides.effect,
      })
      .from(userPermissionOverrides)
      .innerJoin(
        permissions,
        eq(permissions.id, userPermissionOverrides.permissionId),
      )
      .where(eq(userPermissionOverrides.userId, user.id)),
    getEffectiveAuthorization(user.id, user.baseRoleId),
  ]);

  return {
    user: {
      id: user.id,
      displayName: user.displayName,
      username: user.username,
      archivedAt: user.archivedAt,
      baseRole: {
        id: user.baseRoleId,
        code: user.baseRoleCode,
        name: user.baseRoleName,
      },
    },
    basePermissions: baseRows.map((row) => row.code).sort(),
    grants: overrideRows
      .filter((row) => row.effect === "grant")
      .map((row) => row.code)
      .sort(),
    denies: overrideRows
      .filter((row) => row.effect === "deny")
      .map((row) => row.code)
      .sort(),
    effectivePermissions: effective.permissions,
    allowedModules: effective.allowedModules,
  };
}

function authorizationError(error: unknown, requestId: string) {
  if (error instanceof AuthenticationRequiredError) {
    return apiError(
      401,
      error.code,
      "يجب تسجيل الدخول أولاً.",
      requestId,
    );
  }

  if (error instanceof PermissionDeniedError) {
    return apiError(
      403,
      error.code,
      "ليس لديك صلاحية لإدارة صلاحيات المستخدمين.",
      requestId,
    );
  }

  return null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const requestId = randomUUID();

  try {
    const auth = await requirePermission("users.manage");
    const parsedUserId = userIdSchema.safeParse((await params).userId);

    if (!parsedUserId.success) {
      return apiError(
        400,
        "INVALID_USER_ID",
        "معرف المستخدم غير صحيح.",
        requestId,
      );
    }

    const access = await findUserAccess(parsedUserId.data);

    if (!access) {
      return apiError(404, "USER_NOT_FOUND", "المستخدم غير موجود.", requestId);
    }

    if (access.user.baseRole.code === "owner" && auth.user.role.code !== "owner") {
      return apiError(
        403,
        "OWNER_ACCOUNT_RESTRICTED",
        "لا يمكنك عرض صلاحيات حساب صاحب الشركة.",
        requestId,
      );
    }

    return NextResponse.json(access, { status: 200 });
  } catch (error) {
    const authError = authorizationError(error, requestId);
    if (authError) return authError;

    console.error("[USER_PERMISSIONS_GET]", requestId, error);
    return apiError(
      500,
      "INTERNAL_SERVER_ERROR",
      "تعذر تحميل صلاحيات المستخدم.",
      requestId,
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const requestId = randomUUID();

  try {
    const auth = await requirePermission("users.manage");
    const parsedUserId = userIdSchema.safeParse((await params).userId);

    if (!parsedUserId.success) {
      return apiError(
        400,
        "INVALID_USER_ID",
        "معرف المستخدم غير صحيح.",
        requestId,
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError(400, "INVALID_JSON", "بيانات الطلب غير صحيحة.", requestId);
    }

    const parsedBody = permissionOverridesSchema.safeParse(body);
    if (!parsedBody.success) {
      return apiError(
        400,
        "VALIDATION_ERROR",
        "يرجى مراجعة الصلاحيات المحددة.",
        requestId,
        parsedBody.error.flatten(),
      );
    }

    const access = await findUserAccess(parsedUserId.data);
    if (!access) {
      return apiError(404, "USER_NOT_FOUND", "المستخدم غير موجود.", requestId);
    }

    if (access.user.archivedAt) {
      return apiError(
        409,
        "USER_ARCHIVED",
        "يجب استعادة الحساب قبل تعديل صلاحياته.",
        requestId,
      );
    }

    if (access.user.baseRole.code === "owner" && auth.user.role.code !== "owner") {
      return apiError(
        403,
        "OWNER_ACCOUNT_RESTRICTED",
        "لا يمكنك تعديل صلاحيات حساب صاحب الشركة.",
        requestId,
      );
    }

    if (access.user.id === auth.user.id) {
      return apiError(
        409,
        "SELF_PERMISSION_CHANGE_NOT_ALLOWED",
        "لا يمكنك تعديل صلاحيات حسابك الحالي.",
        requestId,
      );
    }

    const requestedCodes = [
      ...parsedBody.data.grants,
      ...parsedBody.data.denies,
    ];
    const permissionRows = requestedCodes.length
      ? await db
          .select({ id: permissions.id, code: permissions.code })
          .from(permissions)
          .where(inArray(permissions.code, requestedCodes))
      : [];

    if (permissionRows.length !== requestedCodes.length) {
      const knownCodes = new Set(permissionRows.map((row) => row.code));
      const unknownCodes = requestedCodes.filter((code) => !knownCodes.has(code));

      return apiError(
        400,
        "UNKNOWN_PERMISSION",
        "تتضمن البيانات صلاحية غير موجودة.",
        requestId,
        { unknownCodes },
      );
    }

    const permissionIds = new Map(
      permissionRows.map((permission) => [permission.code, permission.id]),
    );
    const basePermissions = new Set(access.basePermissions);
    const grants = parsedBody.data.grants.filter(
      (code) => !basePermissions.has(code),
    );
    const denies = parsedBody.data.denies.filter((code) => basePermissions.has(code));
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx
        .delete(userPermissionOverrides)
        .where(eq(userPermissionOverrides.userId, access.user.id));

      const values = [
        ...grants.map((code) => ({
          userId: access.user.id,
          permissionId: permissionIds.get(code)!,
          effect: "grant" as const,
          updatedAt: now,
        })),
        ...denies.map((code) => ({
          userId: access.user.id,
          permissionId: permissionIds.get(code)!,
          effect: "deny" as const,
          updatedAt: now,
        })),
      ];

      if (values.length) {
        await tx.insert(userPermissionOverrides).values(values);
      }
    });

    const updatedAccess = await findUserAccess(access.user.id);
    return NextResponse.json(updatedAccess, { status: 200 });
  } catch (error) {
    const authError = authorizationError(error, requestId);
    if (authError) return authError;

    console.error("[USER_PERMISSIONS_PUT]", requestId, error);
    return apiError(
      500,
      "INTERNAL_SERVER_ERROR",
      "تعذر تحديث صلاحيات المستخدم.",
      requestId,
    );
  }
}
