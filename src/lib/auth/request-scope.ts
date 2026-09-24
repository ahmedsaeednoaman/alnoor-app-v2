import { createHmac } from "node:crypto";
import type { getCurrentSession } from "./session";

type ValidatedSession = NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>;

// Public isolation label, NOT a credential. Domain separation keeps it distinct
// from token hashing; neither the token, its hash nor the session UUID is exposed.
export function authenticatedRequestScope(auth: ValidatedSession) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  const identity = JSON.stringify([
    "alnoor-client-request-scope-v1", auth.session.id, auth.user.id,
    auth.user.role.id, auth.user.role.code,
    [...auth.user.permissions].sort(), [...auth.user.allowedModules].sort(),
  ]);
  return {
    scope: createHmac("sha256", secret).update(identity).digest("base64url"),
    expiresAt: auth.session.expiresAt.toISOString(),
  };
}
