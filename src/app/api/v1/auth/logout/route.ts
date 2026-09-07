import {
  createHash,
  randomUUID,
} from "node:crypto";

import {
  and,
  eq,
  isNull,
} from "drizzle-orm";

import {
  cookies,
} from "next/headers";

import {
  NextResponse,
} from "next/server";

import {
  db,
} from "@/db/client";

import {
  sessions,
} from "@/db/schema";

export const runtime = "nodejs";

function hashSessionToken(
  rawToken: string,
) {
  const sessionSecret =
    process.env.SESSION_SECRET;

  if (!sessionSecret) {
    throw new Error(
      "SESSION_SECRET is not configured",
    );
  }

  return createHash("sha256")
    .update(
      `${rawToken}.${sessionSecret}`,
    )
    .digest("hex");
}

export async function POST() {
  const requestId =
    randomUUID();

  try {
    const cookieStore =
      await cookies();

    const rawToken =
      cookieStore.get(
        "session_token",
      )?.value;

    /*
     * لو فيه Session:
     * نلغيها في قاعدة البيانات.
     */
    if (rawToken) {
      const tokenHash =
        hashSessionToken(
          rawToken,
        );

      await db
        .update(sessions)
        .set({
          revokedAt:
            new Date(),
        })
        .where(
          and(
            eq(
              sessions.tokenHash,
              tokenHash,
            ),
            isNull(
              sessions.revokedAt,
            ),
          ),
        );
    }

    /*
     * نمسح الكوكي سواء
     * الجلسة موجودة أو لا.
     *
     * Logout يكون idempotent:
     * الضغط عليه أكثر من مرة
     * لا يسبب خطأ للمستخدم.
     */
    cookieStore.delete(
      "session_token",
    );

    return NextResponse.json(
      {
        success: true,

        message:
          "تم تسجيل الخروج بنجاح.",
      },
      {
        status: 200,
      },
    );
  } catch (error) {
    console.error(
      "[AUTH_LOGOUT]",
      requestId,
      error,
    );

    return NextResponse.json(
      {
        error: {
          code:
            "LOGOUT_FAILED",

          message:
            "تعذر تسجيل الخروج.",

          requestId,
        },
      },
      {
        status: 500,
      },
    );
  }
}