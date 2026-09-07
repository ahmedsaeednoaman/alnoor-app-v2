import { createHash, randomBytes, randomUUID } from "node:crypto";

import * as argon2 from "argon2";

import { eq } from "drizzle-orm";

import { cookies } from "next/headers";

import { NextResponse } from "next/server";

import { z } from "zod";

import { db } from "@/db/client";

import { roles, sessions, users } from "@/db/schema";

import { getEffectiveAuthorization } from "@/lib/auth/permissions";

export const runtime = "nodejs";

const loginSchema = z.object({
  username: z.string().trim().min(1),

  password: z.string().min(1),
});

function errorResponse(
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

function hashSessionToken(rawToken: string) {
  const sessionSecret = process.env.SESSION_SECRET;

  if (!sessionSecret) {
    throw new Error("SESSION_SECRET is not configured");
  }

  return createHash("sha256")
    .update(`${rawToken}.${sessionSecret}`)
    .digest("hex");
}

export async function POST(request: Request) {
  const requestId = randomUUID();

  try {
    let json: unknown;

    try {
      json = await request.json();
    } catch {
      return errorResponse(
        400,
        "INVALID_REQUEST",
        "بيانات الطلب غير صحيحة.",
        requestId,
      );
    }

    const parsed = loginSchema.safeParse(json);

    if (!parsed.success) {
      return errorResponse(
        400,
        "MISSING_CREDENTIALS",
        "اسم المستخدم وكلمة المرور مطلوبان.",
        requestId,
      );
    }

    const username = parsed.data.username.toLowerCase();

    const password = parsed.data.password;

    /* ========================================
       USER
       ======================================== */

    const [record] = await db
      .select({
        userId: users.id,

        username: users.username,

        passwordHash: users.passwordHash,

        displayName: users.displayName,

        status: users.status,

        archivedAt: users.archivedAt,

        roleId: roles.id,

        roleCode: roles.code,

        roleName: roles.name,
      })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.baseRoleId))
      .where(eq(users.username, username))
      .limit(1);

    if (!record) {
      return errorResponse(
        401,
        "INVALID_CREDENTIALS",
        "اسم المستخدم أو كلمة المرور غير صحيحة.",
        requestId,
      );
    }

    /* ========================================
       PASSWORD
       ======================================== */

    const passwordMatches = await argon2.verify(record.passwordHash, password);

    if (!passwordMatches) {
      return errorResponse(
        401,
        "INVALID_CREDENTIALS",
        "اسم المستخدم أو كلمة المرور غير صحيحة.",
        requestId,
      );
    }

    /* ========================================
       STATUS

       Check this only after the password is verified so an unauthenticated
       caller cannot discover whether a known username is blocked/suspended.
       ======================================== */

    if (record.archivedAt) {
      return errorResponse(
        423,
        "ACCOUNT_UNAVAILABLE",
        "الحساب غير متاح حالياً.",
        requestId,
      );
    }

    if (record.status === "blocked") {
      return errorResponse(
        423,
        "ACCOUNT_BLOCKED",
        "الحساب محظور حالياً.",
        requestId,
      );
    }

    if (record.status === "suspended") {
      return errorResponse(
        423,
        "ACCOUNT_SUSPENDED",
        "الحساب موقوف حالياً.",
        requestId,
      );
    }

    /* ========================================
       EFFECTIVE PERMISSIONS
       ======================================== */

    const authorization = await getEffectiveAuthorization(
      record.userId,
      record.roleId,
    );

    /* ========================================
       SESSION
       ======================================== */

    const rawToken = randomBytes(32).toString("base64url");

    const tokenHash = hashSessionToken(rawToken);

    const now = new Date();

    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    await db.transaction(async (tx) => {
      await tx.insert(sessions).values({
        userId: record.userId,

        tokenHash,

        expiresAt,
      });

      await tx
        .update(users)
        .set({
          lastLoginAt: now,

          updatedAt: now,
        })
        .where(eq(users.id, record.userId));
    });

    /* ========================================
       COOKIE
       ======================================== */

    const cookieStore = await cookies();

    cookieStore.set({
      name: "session_token",

      value: rawToken,

      httpOnly: true,

      secure: process.env.NODE_ENV === "production",

      sameSite: "lax",

      path: "/",

      expires: expiresAt,
    });

    /* ========================================
       RESPONSE
       ======================================== */

    return NextResponse.json(
      {
        currentUser: {
          id: record.userId,

          displayName: record.displayName,
        },

        permissions: authorization.permissions,

        allowedModules: authorization.allowedModules,

        session: {
          expiresAt: expiresAt.toISOString(),
        },
      },
      {
        status: 200,
      },
    );
  } catch (error) {
    console.error("[AUTH_LOGIN]", requestId, error);

    return errorResponse(
      500,
      "INTERNAL_SERVER_ERROR",
      "حدث خطأ داخلي أثناء تسجيل الدخول.",
      requestId,
    );
  }
}
