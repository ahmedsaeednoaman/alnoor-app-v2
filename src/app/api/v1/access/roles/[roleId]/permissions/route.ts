import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db/client";
import { permissions, rolePermissions, roles } from "@/db/schema";
import {
  AuthenticationRequiredError,
  PermissionDeniedError,
  requirePermission,
} from "@/lib/auth/guards";

export const runtime = "nodejs";

const roleIdSchema = z.string().uuid("معرف الدور غير صحيح.");

const updateRolePermissionsSchema = z
  .object({
    permissionIds: z.array(z.string().uuid("معرف الصلاحية غير صحيح.")).max(200),
  })
  .superRefine((value, context) => {
    if (new Set(value.permissionIds).size !== value.permissionIds.length) {
      context.addIssue({
        code: "custom",
        path: ["permissionIds"],
        message: "تحتوي الصلاحيات على قيم مكررة.",
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

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ roleId: string }> },
) {
  const requestId = randomUUID();

  try {
    const auth = await requirePermission("settings.manage");

    if (auth.user.role.code !== "owner") {
      return apiError(
        403,
        "OWNER_REQUIRED",
        "إدارة الصلاحيات الافتراضية للأدوار متاحة للمالك فقط.",
        requestId,
      );
    }

    const parsedRoleId = roleIdSchema.safeParse((await params).roleId);
    if (!parsedRoleId.success) {
      return apiError(
        400,
        "INVALID_ROLE_ID",
        "معرف الدور غير صحيح.",
        requestId,
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError(400, "INVALID_JSON", "بيانات الطلب غير صحيحة.", requestId);
    }

    const parsedBody = updateRolePermissionsSchema.safeParse(body);
    if (!parsedBody.success) {
      return apiError(
        400,
        "VALIDATION_ERROR",
        "يرجى مراجعة الصلاحيات المحددة.",
        requestId,
        parsedBody.error.flatten(),
      );
    }

    const [role] = await db
      .select({
        id: roles.id,
        code: roles.code,
        name: roles.name,
        description: roles.description,
      })
      .from(roles)
      .where(eq(roles.id, parsedRoleId.data))
      .limit(1);

    if (!role) {
      return apiError(404, "ROLE_NOT_FOUND", "الدور غير موجود.", requestId);
    }

    if (role.code === "owner") {
      return apiError(
        409,
        "OWNER_ROLE_LOCKED",
        "صلاحيات دور المالك محمية ولا يمكن تعديلها من هذه الشاشة.",
        requestId,
      );
    }

    const requestedIds = parsedBody.data.permissionIds;
    const permissionRows = requestedIds.length
      ? await db
          .select({ id: permissions.id })
          .from(permissions)
          .where(inArray(permissions.id, requestedIds))
      : [];

    if (permissionRows.length !== requestedIds.length) {
      const knownIds = new Set(permissionRows.map((permission) => permission.id));
      const unknownPermissionIds = requestedIds.filter((id) => !knownIds.has(id));

      return apiError(
        400,
        "UNKNOWN_PERMISSION",
        "تتضمن البيانات صلاحية غير موجودة.",
        requestId,
        { unknownPermissionIds },
      );
    }

    const now = new Date();

    await db.transaction(async (tx) => {
      await tx
        .delete(rolePermissions)
        .where(eq(rolePermissions.roleId, role.id));

      if (requestedIds.length) {
        await tx.insert(rolePermissions).values(
          requestedIds.map((permissionId) => ({
            roleId: role.id,
            permissionId,
          })),
        );
      }

      await tx.update(roles).set({ updatedAt: now }).where(eq(roles.id, role.id));
    });

    return NextResponse.json(
      {
        role: {
          ...role,
          defaultPermissionIds: requestedIds,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return apiError(401, error.code, "يجب تسجيل الدخول أولاً.", requestId);
    }

    if (error instanceof PermissionDeniedError) {
      return apiError(
        403,
        error.code,
        "ليس لديك صلاحية لإدارة الأدوار.",
        requestId,
      );
    }

    console.error("[ROLE_PERMISSIONS_UPDATE]", requestId, error);
    return apiError(
      500,
      "INTERNAL_SERVER_ERROR",
      "تعذر تحديث صلاحيات الدور.",
      requestId,
    );
  }
}
