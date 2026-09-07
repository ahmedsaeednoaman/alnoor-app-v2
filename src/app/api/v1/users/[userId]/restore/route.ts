import { randomUUID } from "node:crypto";

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
    if (!parsed.success)
      return apiError(
        400,
        "INVALID_USER_ID",
        "معرف المستخدم غير صحيح.",
        requestId,
      );

    const [target] = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        archivedAt: users.archivedAt,
        roleCode: roles.code,
      })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.baseRoleId))
      .where(eq(users.id, parsed.data))
      .limit(1);

    if (!target)
      return apiError(404, "USER_NOT_FOUND", "المستخدم غير موجود.", requestId);
    if (target.roleCode === "owner" && auth.user.role.code !== "owner") {
      return apiError(
        403,
        "OWNER_ACCOUNT_RESTRICTED",
        "لا يمكنك استعادة حساب صاحب الشركة.",
        requestId,
      );
    }
    if (!target.archivedAt)
      return NextResponse.json({ user: target, alreadyRestored: true });

    const now = new Date();
    const [user] = await db
      .update(users)
      .set({ archivedAt: null, updatedAt: now })
      .where(eq(users.id, target.id))
      .returning({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        archivedAt: users.archivedAt,
      });

    return NextResponse.json({ user, alreadyRestored: false });
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
    console.error("[USER_RESTORE]", requestId, error);
    return apiError(
      500,
      "INTERNAL_SERVER_ERROR",
      "تعذر استعادة المستخدم.",
      requestId,
    );
  }
}
