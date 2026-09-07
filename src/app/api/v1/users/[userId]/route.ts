import { randomUUID } from "node:crypto";

import { and, eq, isNull, ne } from "drizzle-orm";

import { NextResponse } from "next/server";

import { z } from "zod";

import { db } from "@/db/client";

import { roles, users } from "@/db/schema";

import {
  AuthenticationRequiredError,
  PermissionDeniedError,
  requirePermission,
} from "@/lib/auth/guards";

import { canHardDeleteUser } from "@/lib/users/user-deletion";

export const runtime = "nodejs";

/* =========================================================
   VALIDATION
   ========================================================= */

const userIdSchema = z.string().uuid("معرف المستخدم غير صحيح.");

const updateUserSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, "الاسم الظاهر مطلوب.")
    .max(150, "الاسم الظاهر طويل جداً."),

  username: z
    .string()
    .trim()
    .min(3, "اسم المستخدم يجب أن يكون 3 أحرف على الأقل.")
    .max(80, "اسم المستخدم طويل جداً.")
    .regex(
      /^[a-zA-Z0-9._-]+$/,
      "اسم المستخدم يمكن أن يحتوي على حروف إنجليزية وأرقام و . _ - فقط.",
    ),

  baseRoleId: z.string().uuid("الدور الأساسي غير صحيح."),

  status: z.enum(["active", "suspended", "blocked"]),
});

/* =========================================================
   HELPERS
   ========================================================= */

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

function isPostgresUniqueViolation(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const direct = error as {
    code?: string;

    cause?: {
      code?: string;
    };
  };

  return direct.code === "23505" || direct.cause?.code === "23505";
}

async function findUserById(userId: string) {
  const [record] = await db
    .select({
      id: users.id,

      username: users.username,

      displayName: users.displayName,

      status: users.status,

      archivedAt: users.archivedAt,

      lastLoginAt: users.lastLoginAt,

      createdAt: users.createdAt,

      updatedAt: users.updatedAt,

      baseRole: {
        id: roles.id,

        code: roles.code,

        name: roles.name,

        description: roles.description,
      },
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.baseRoleId))
    .where(eq(users.id, userId))
    .limit(1);

  return record ?? null;
}

/* =========================================================
   GET /api/v1/users/[userId]
   ========================================================= */

export async function GET(
  _request: Request,
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
    await requirePermission("users.view");

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

    const user = await findUserById(parsedUserId.data);

    if (!user) {
      return apiError(404, "USER_NOT_FOUND", "المستخدم غير موجود.", requestId);
    }

    return NextResponse.json(
      {
        user,
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
        "ليس لديك صلاحية لعرض بيانات المستخدم.",
        requestId,
      );
    }

    console.error("[USER_DETAILS]", requestId, error);

    return apiError(
      500,
      "INTERNAL_SERVER_ERROR",
      "حدث خطأ أثناء تحميل بيانات المستخدم.",
      requestId,
    );
  }
}

/* =========================================================
   PATCH /api/v1/users/[userId]
   ========================================================= */

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

    const parsed = updateUserSchema.safeParse(body);

    if (!parsed.success) {
      return apiError(
        400,
        "VALIDATION_ERROR",
        "يرجى مراجعة البيانات المدخلة.",
        requestId,
        parsed.error.flatten(),
      );
    }

    /* ========================================
       CURRENT USER
       ======================================== */

    const currentUser = await findUserById(parsedUserId.data);

    if (!currentUser) {
      return apiError(404, "USER_NOT_FOUND", "المستخدم غير موجود.", requestId);
    }

    if (currentUser.archivedAt) {
      return apiError(
        409,
        "USER_ARCHIVED",
        "يجب استعادة الحساب قبل تعديل بياناته.",
        requestId,
      );
    }

    /*
     * مستخدم عنده users.manage
     * لكنه ليس Owner لا يمكنه تعديل
     * حساب Owner.
     */
    if (
      currentUser.baseRole.code === "owner" &&
      auth.user.role.code !== "owner"
    ) {
      return apiError(
        403,
        "OWNER_ACCOUNT_RESTRICTED",
        "لا يمكنك تعديل حساب صاحب الشركة.",
        requestId,
      );
    }

    /* ========================================
       TARGET ROLE
       ======================================== */

    const [selectedRole] = await db
      .select({
        id: roles.id,

        code: roles.code,

        name: roles.name,
      })
      .from(roles)
      .where(eq(roles.id, parsed.data.baseRoleId))
      .limit(1);

    if (!selectedRole) {
      return apiError(
        400,
        "INVALID_ROLE",
        "الدور الأساسي المحدد غير موجود.",
        requestId,
      );
    }

    /*
     * users.manage وحدها لا تسمح
     * بترقية مستخدم إلى Owner.
     */
    if (selectedRole.code === "owner" && auth.user.role.code !== "owner") {
      return apiError(
        403,
        "OWNER_ROLE_RESTRICTED",
        "لا يمكن منح دور صاحب الشركة لهذا الحساب.",
        requestId,
      );
    }

    /* ========================================
       PROTECT LAST ACTIVE OWNER
       ======================================== */

    const removingOwnerAccess =
      currentUser.baseRole.code === "owner" &&
      (selectedRole.code !== "owner" || parsed.data.status !== "active");

    if (removingOwnerAccess) {
      const activeOwners = await db
        .select({
          id: users.id,
        })
        .from(users)
        .innerJoin(roles, eq(roles.id, users.baseRoleId))
        .where(
          and(
            eq(roles.code, "owner"),

            eq(users.status, "active"),
          ),
        );

      if (activeOwners.length <= 1) {
        return apiError(
          409,
          "LAST_ACTIVE_OWNER",
          "لا يمكن إيقاف أو إزالة دور آخر صاحب شركة نشط.",
          requestId,
        );
      }
    }

    /* ========================================
       USERNAME
       ======================================== */

    const username = parsed.data.username.trim().toLowerCase();

    const [duplicateUser] = await db
      .select({
        id: users.id,
      })
      .from(users)
      .where(
        and(
          eq(users.username, username),

          ne(users.id, currentUser.id),
        ),
      )
      .limit(1);

    if (duplicateUser) {
      return apiError(
        409,
        "USERNAME_ALREADY_EXISTS",
        "اسم المستخدم مستخدم بالفعل.",
        requestId,
      );
    }

    /* ========================================
       UPDATE USER
       ======================================== */

    const now = new Date();

    await db
      .update(users)
      .set({
        displayName: parsed.data.displayName.trim(),

        username,

        baseRoleId: selectedRole.id,

        status: parsed.data.status,

        updatedAt: now,
      })
      .where(eq(users.id, currentUser.id));

    const updatedUser = await findUserById(currentUser.id);

    return NextResponse.json(
      {
        user: updatedUser,
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

    if (isPostgresUniqueViolation(error)) {
      return apiError(
        409,
        "USERNAME_ALREADY_EXISTS",
        "اسم المستخدم مستخدم بالفعل.",
        requestId,
      );
    }

    console.error("[USER_UPDATE]", requestId, error);

    return apiError(
      500,
      "INTERNAL_SERVER_ERROR",
      "حدث خطأ أثناء تعديل المستخدم.",
      requestId,
    );
  }
}

/* =========================================================
   DELETE /api/v1/users/[userId]
   ========================================================= */

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const requestId = randomUUID();

  try {
    const auth = await requirePermission("users.manage");
    const parsed = userIdSchema.safeParse((await params).userId);

    if (!parsed.success) {
      return apiError(
        400,
        "INVALID_USER_ID",
        "معرف المستخدم غير صحيح.",
        requestId,
      );
    }

    if (parsed.data === auth.user.id) {
      return apiError(
        409,
        "SELF_DELETE_NOT_ALLOWED",
        "لا يمكنك حذف حسابك الحالي.",
        requestId,
      );
    }

    const target = await findUserById(parsed.data);
    if (!target)
      return apiError(404, "USER_NOT_FOUND", "المستخدم غير موجود.", requestId);

    if (target.baseRole.code === "owner" && auth.user.role.code !== "owner") {
      return apiError(
        403,
        "OWNER_ACCOUNT_RESTRICTED",
        "لا يمكنك حذف حساب صاحب الشركة.",
        requestId,
      );
    }

    if (
      target.baseRole.code === "owner" &&
      target.status === "active" &&
      !target.archivedAt
    ) {
      const activeOwners = await db
        .select({ id: users.id })
        .from(users)
        .innerJoin(roles, eq(roles.id, users.baseRoleId))
        .where(
          and(
            eq(roles.code, "owner"),
            eq(users.status, "active"),
            isNull(users.archivedAt),
          ),
        );

      if (activeOwners.length <= 1) {
        return apiError(
          409,
          "LAST_ACTIVE_OWNER",
          "لا يمكن حذف آخر صاحب شركة نشط.",
          requestId,
        );
      }
    }

    const eligibility = await canHardDeleteUser(target.id);
    if (!eligibility.allowed) {
      return apiError(
        409,
        "USER_HAS_LINKED_RECORDS",
        "لا يمكن حذف هذا الحساب لوجود سجلات ونشاطات مرتبطة به. يمكنك أرشفته بدلاً من ذلك.",
        requestId,
        {
          referenceCount: eligibility.references.reduce(
            (sum, item) => sum + item.count,
            0,
          ),
        },
      );
    }

    await db.transaction(async (tx) => {
      await tx.delete(users).where(eq(users.id, target.id));
    });

    return NextResponse.json({ success: true, deletedUserId: target.id });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return apiError(401, error.code, "يجب تسجيل الدخول أولاً.", requestId);
    }
    if (error instanceof PermissionDeniedError) {
      return apiError(
        403,
        error.code,
        "ليس لديك صلاحية لإدارة المستخدمين.",
        requestId,
      );
    }

    const postgresError = error as { code?: string; cause?: { code?: string } };
    if (
      postgresError.code === "23503" ||
      postgresError.cause?.code === "23503"
    ) {
      return apiError(
        409,
        "USER_HAS_LINKED_RECORDS",
        "لا يمكن حذف هذا الحساب لوجود سجلات ونشاطات مرتبطة به. يمكنك أرشفته بدلاً من ذلك.",
        requestId,
      );
    }

    console.error("[USER_DELETE]", requestId, error);
    return apiError(
      500,
      "INTERNAL_SERVER_ERROR",
      "تعذر حذف المستخدم.",
      requestId,
    );
  }
}
