import { randomUUID } from "node:crypto";

import * as argon2 from "argon2";

import { asc, eq, isNotNull, isNull } from "drizzle-orm";

import { NextResponse } from "next/server";

import { z } from "zod";

import { db } from "@/db/client";

import { roles, users } from "@/db/schema";

import {
  AuthenticationRequiredError,
  PermissionDeniedError,
  requirePermission,
} from "@/lib/auth/guards";

/* =========================================================
   RUNTIME
   ========================================================= */

export const runtime = "nodejs";

/* =========================================================
   VALIDATION
   ========================================================= */

const createUserSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, "اسم المستخدم الظاهر مطلوب.")
    .max(150, "اسم المستخدم الظاهر طويل جداً."),

  username: z
    .string()
    .trim()
    .min(3, "اسم المستخدم يجب أن يكون 3 أحرف على الأقل.")
    .max(80, "اسم المستخدم طويل جداً.")
    .regex(
      /^[a-zA-Z0-9._-]+$/,
      "اسم المستخدم يمكن أن يحتوي على حروف إنجليزية وأرقام و . _ - فقط.",
    ),

  password: z
    .string()
    .min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل.")
    .max(128, "كلمة المرور طويلة جداً."),

  baseRoleId: z.string().uuid("الدور الأساسي غير صحيح."),

  status: z.enum(["active", "suspended", "blocked"]).default("active"),
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

/* =========================================================
   GET /api/v1/users
   ========================================================= */

/**
 * يعرض المستخدمين.
 *
 * يحتاج:
 * users.view
 *
 * ملاحظة أمنية:
 * لا يتم إرجاع passwordHash.
 */
export async function GET(request: Request) {
  const requestId = randomUUID();

  try {
    await requirePermission("users.view");

    const tab = new URL(request.url).searchParams.get("tab");

    if (tab !== null && tab !== "archived") {
      return apiError(
        400,
        "INVALID_TAB",
        "قيمة تبويب المستخدمين غير صحيحة.",
        requestId,
      );
    }

    const archived = tab === "archived";

    const records = await db
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
        },
      })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.baseRoleId))
      .where(archived ? isNotNull(users.archivedAt) : isNull(users.archivedAt))
      .orderBy(asc(users.displayName));

    return NextResponse.json(
      {
        users: records,

        meta: {
          count: records.length,
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
        "ليس لديك صلاحية لعرض المستخدمين.",
        requestId,
      );
    }

    console.error("[USERS_LIST]", requestId, error);

    return apiError(
      500,
      "INTERNAL_SERVER_ERROR",
      "حدث خطأ أثناء تحميل المستخدمين.",
      requestId,
    );
  }
}

/* =========================================================
   POST /api/v1/users
   ========================================================= */

/**
 * إنشاء مستخدم جديد.
 *
 * يحتاج:
 * users.manage
 */
export async function POST(request: Request) {
  const requestId = randomUUID();

  try {
    const auth = await requirePermission("users.manage");

    /* -----------------------------------------
       BODY
       ----------------------------------------- */

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

    const parsed = createUserSchema.safeParse(body);

    if (!parsed.success) {
      return apiError(
        400,
        "VALIDATION_ERROR",
        "يرجى مراجعة البيانات المدخلة.",
        requestId,
        parsed.error.flatten(),
      );
    }

    const { displayName, password, baseRoleId, status } = parsed.data;

    const username = parsed.data.username.trim().toLowerCase();

    /* -----------------------------------------
       ROLE
       ----------------------------------------- */

    const [selectedRole] = await db
      .select({
        id: roles.id,

        code: roles.code,

        name: roles.name,
      })
      .from(roles)
      .where(eq(roles.id, baseRoleId))
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
     * حماية إضافية:
     *
     * في الوقت الحالي إنشاء Owner جديد
     * متاح فقط إذا المنفذ نفسه Owner.
     *
     * users.manage وحدها لا تكفي لترقية
     * شخص آخر إلى Owner.
     */
    if (selectedRole.code === "owner" && auth.user.role.code !== "owner") {
      return apiError(
        403,
        "OWNER_ROLE_RESTRICTED",
        "لا يمكن منح صلاحيات صاحب الشركة لهذا الحساب.",
        requestId,
      );
    }

    /* -----------------------------------------
       DUPLICATE USERNAME
       ----------------------------------------- */

    const [existingUser] = await db
      .select({
        id: users.id,
      })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    if (existingUser) {
      return apiError(
        409,
        "USERNAME_ALREADY_EXISTS",
        "اسم المستخدم مستخدم بالفعل.",
        requestId,
      );
    }

    /* -----------------------------------------
       PASSWORD
       ----------------------------------------- */

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
    });

    /* -----------------------------------------
       CREATE
       ----------------------------------------- */

    const [createdUser] = await db
      .insert(users)
      .values({
        username,

        displayName,

        passwordHash,

        baseRoleId: selectedRole.id,

        status,
      })
      .returning({
        id: users.id,

        username: users.username,

        displayName: users.displayName,

        status: users.status,

        createdAt: users.createdAt,
      });

    return NextResponse.json(
      {
        user: {
          ...createdUser,

          baseRole: {
            id: selectedRole.id,

            code: selectedRole.code,

            name: selectedRole.name,
          },
        },
      },
      {
        status: 201,
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

    /*
     * حتى مع فحص username قبل الإدخال
     * Unique Index يظل الحماية النهائية
     * لو حصل طلبان في نفس اللحظة.
     */
    if (isPostgresUniqueViolation(error)) {
      return apiError(
        409,
        "USERNAME_ALREADY_EXISTS",
        "اسم المستخدم مستخدم بالفعل.",
        requestId,
      );
    }

    console.error("[USER_CREATE]", requestId, error);

    return apiError(
      500,
      "INTERNAL_SERVER_ERROR",
      "حدث خطأ أثناء إنشاء المستخدم.",
      requestId,
    );
  }
}
