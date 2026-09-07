import { randomUUID } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db/client";
import { roles, sessions, users } from "@/db/schema";
import {
  AuthenticationRequiredError,
  PermissionDeniedError,
  requirePermission,
} from "@/lib/auth/guards";

export const runtime = "nodejs";

const userIdSchema = z.string().uuid();

function apiError(
  status: number,
  code: string,
  message: string,
  requestId: string,
) {
  return NextResponse.json({ error: { code, message, requestId } }, { status });
}

export async function POST(
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
        "SELF_ARCHIVE_NOT_ALLOWED",
        "لا يمكنك أرشفة حسابك الحالي.",
        requestId,
      );
    }

    const result = await db.transaction(async (tx) => {
      const [target] = await tx
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          status: users.status,
          archivedAt: users.archivedAt,
          roleCode: roles.code,
        })
        .from(users)
        .innerJoin(roles, eq(roles.id, users.baseRoleId))
        .where(eq(users.id, parsed.data))
        .limit(1);

      if (!target) return { error: "USER_NOT_FOUND" as const };

      if (target.roleCode === "owner" && auth.user.role.code !== "owner") {
        return { error: "OWNER_ACCOUNT_RESTRICTED" as const };
      }

      if (target.archivedAt) return { user: target, alreadyArchived: true };

      if (target.roleCode === "owner" && target.status === "active") {
        const activeOwners = await tx
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

        if (activeOwners.length <= 1)
          return { error: "LAST_ACTIVE_OWNER" as const };
      }

      const now = new Date();
      const [user] = await tx
        .update(users)
        .set({ archivedAt: now, updatedAt: now })
        .where(eq(users.id, target.id))
        .returning({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          archivedAt: users.archivedAt,
        });

      await tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.userId, target.id), isNull(sessions.revokedAt)));

      return { user, alreadyArchived: false };
    });

    if ("error" in result) {
      if (result.error === "USER_NOT_FOUND")
        return apiError(404, result.error, "المستخدم غير موجود.", requestId);
      if (result.error === "OWNER_ACCOUNT_RESTRICTED")
        return apiError(
          403,
          result.error,
          "لا يمكنك أرشفة حساب صاحب الشركة.",
          requestId,
        );
      return apiError(
        409,
        "LAST_ACTIVE_OWNER",
        "لا يمكن أرشفة آخر صاحب شركة نشط.",
        requestId,
      );
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError)
      return apiError(401, error.code, "يجب تسجيل الدخول أولاً.", requestId);
    if (error instanceof PermissionDeniedError)
      return apiError(
        403,
        error.code,
        "ليس لديك صلاحية لإدارة المستخدمين.",
        requestId,
      );
    console.error("[USER_ARCHIVE]", requestId, error);
    return apiError(
      500,
      "INTERNAL_SERVER_ERROR",
      "تعذر أرشفة المستخدم.",
      requestId,
    );
  }
}
