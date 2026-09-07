import { randomUUID } from "node:crypto";

import * as argon2 from "argon2";

import { eq } from "drizzle-orm";

import { NextResponse } from "next/server";

import { z } from "zod";

import { db } from "@/db/client";

import { roles, users } from "@/db/schema";

import {
  AuthenticationRequiredError,
  PermissionDeniedError,
  requirePermission,
} from "@/lib/auth/guards";

export const runtime = "nodejs";

const userIdSchema = z.string().uuid();

const resetPasswordSchema = z.object({
  password: z
    .string()
    .min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل.")
    .max(128, "كلمة المرور طويلة جداً."),
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

        ...(details
          ? {
              details,
            }
          : {}),
      },
    },
    {
      status,
    },
  );
}

export async function PATCH(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      userId: string;
    }>;
  },
) {
  const requestId = randomUUID();

  try {
    const auth = await requirePermission("users.manage");

    const { userId } = await params;

    const parsedUserId = userIdSchema.safeParse(userId);

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
      return apiError(
        400,
        "INVALID_JSON",
        "بيانات الطلب غير صحيحة.",
        requestId,
      );
    }

    const parsed = resetPasswordSchema.safeParse(body);

    if (!parsed.success) {
      return apiError(
        400,
        "VALIDATION_ERROR",
        "يرجى مراجعة كلمة المرور الجديدة.",
        requestId,
        parsed.error.flatten(),
      );
    }

    /*
     * نجيب الحساب المستهدف ودوره.
     * لا نقرأ passwordHash ولا نرجعه.
     */
    const [targetUser] = await db
      .select({
        id: users.id,

        displayName: users.displayName,

        archivedAt: users.archivedAt,

        roleCode: roles.code,
      })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.baseRoleId))
      .where(eq(users.id, parsedUserId.data))
      .limit(1);

    if (!targetUser) {
      return apiError(404, "USER_NOT_FOUND", "المستخدم غير موجود.", requestId);
    }

    if (targetUser.archivedAt) {
      return apiError(
        409,
        "USER_ARCHIVED",
        "لا يمكن تغيير كلمة مرور حساب مؤرشف.",
        requestId,
      );
    }

    /*
     * حماية حسابات Owner:
     * حتى لو مستخدم آخر عنده users.manage،
     * لا يمكنه تغيير Password للـOwner
     * إلا لو المنفذ نفسه Owner.
     */
    if (targetUser.roleCode === "owner" && auth.user.role.code !== "owner") {
      return apiError(
        403,
        "OWNER_ACCOUNT_RESTRICTED",
        "لا يمكنك إعادة تعيين كلمة مرور صاحب الشركة.",
        requestId,
      );
    }

    const passwordHash = await argon2.hash(parsed.data.password, {
      type: argon2.argon2id,
    });

    await db
      .update(users)
      .set({
        passwordHash,

        updatedAt: new Date(),
      })
      .where(eq(users.id, targetUser.id));

    return NextResponse.json(
      {
        success: true,

        user: {
          id: targetUser.id,

          displayName: targetUser.displayName,
        },
      },
      {
        status: 200,
      },
    );
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return apiError(
        401,
        "AUTHENTICATION_REQUIRED",
        "يجب تسجيل الدخول أولاً.",
        requestId,
      );
    }

    if (error instanceof PermissionDeniedError) {
      return apiError(
        403,
        "PERMISSION_DENIED",
        "ليس لديك صلاحية لإدارة المستخدمين.",
        requestId,
      );
    }

    console.error("[USER_PASSWORD_RESET]", requestId, error);

    return apiError(
      500,
      "INTERNAL_SERVER_ERROR",
      "حدث خطأ أثناء إعادة تعيين كلمة المرور.",
      requestId,
    );
  }
}
