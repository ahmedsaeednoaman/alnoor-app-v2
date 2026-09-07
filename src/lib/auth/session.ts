import { createHash } from "node:crypto";

import { and, eq, gt, isNull } from "drizzle-orm";

import { cookies } from "next/headers";

import { db } from "@/db/client";

import { roles, sessions, users } from "@/db/schema";

import { getEffectiveAuthorization } from "./permissions";

function hashSessionToken(rawToken: string) {
  const sessionSecret = process.env.SESSION_SECRET;

  if (!sessionSecret) {
    throw new Error("SESSION_SECRET is not configured");
  }

  return createHash("sha256")
    .update(`${rawToken}.${sessionSecret}`)
    .digest("hex");
}

export async function getCurrentSession() {
  const cookieStore = await cookies();

  const rawToken = cookieStore.get("session_token")?.value;

  if (!rawToken) {
    return null;
  }

  const tokenHash = hashSessionToken(rawToken);

  const now = new Date();

  const [record] = await db
    .select({
      sessionId: sessions.id,

      expiresAt: sessions.expiresAt,

      userId: users.id,

      username: users.username,

      displayName: users.displayName,

      status: users.status,

      archivedAt: users.archivedAt,

      roleId: roles.id,

      roleCode: roles.code,

      roleName: roles.name,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(roles, eq(roles.id, users.baseRoleId))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),

        isNull(sessions.revokedAt),

        gt(sessions.expiresAt, now),

        isNull(users.archivedAt),
      ),
    )
    .limit(1);

  if (!record) {
    return null;
  }

  if (record.status !== "active") {
    return null;
  }

  const authorization = await getEffectiveAuthorization(
    record.userId,
    record.roleId,
  );

  return {
    session: {
      id: record.sessionId,

      expiresAt: record.expiresAt,
    },

    user: {
      id: record.userId,

      username: record.username,

      displayName: record.displayName,

      role: {
        id: record.roleId,

        code: record.roleCode,

        name: record.roleName,
      },

      permissions: authorization.permissions,

      allowedModules: authorization.allowedModules,
    },
  };
}
