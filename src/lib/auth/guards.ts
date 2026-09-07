import { getCurrentSession } from "./session";

export class AuthenticationRequiredError extends Error {
  readonly code = "AUTHENTICATION_REQUIRED";

  constructor() {
    super("Authentication is required.");
    this.name = "AuthenticationRequiredError";
  }
}

export class PermissionDeniedError extends Error {
  readonly code = "PERMISSION_DENIED";
  readonly permission?: string;

  constructor(permission?: string) {
    super(
      permission
        ? `Permission required: ${permission}`
        : "Permission denied."
    );
    this.name = "PermissionDeniedError";
    this.permission = permission;
  }
}

/**
 * يجب وجود Session صحيحة ومستخدم Active.
 */
export async function requireAuthenticatedUser() {
  const auth = await getCurrentSession();

  if (!auth) {
    throw new AuthenticationRequiredError();
  }

  return auth;
}

/**
 * يشترط Permission واحدة محددة.
 * مثال: requirePermission("users.view")
 */
export async function requirePermission(permission: string) {
  const auth = await requireAuthenticatedUser();

  if (!auth.user.permissions.includes(permission)) {
    throw new PermissionDeniedError(permission);
  }

  return auth;
}

/**
 * المستخدم يحتاج واحدة على الأقل من مجموعة الصلاحيات.
 */
export async function requireAnyPermission(requiredPermissions: string[]) {
  const auth = await requireAuthenticatedUser();

  const allowed = requiredPermissions.some((permission) =>
    auth.user.permissions.includes(permission)
  );

  if (!allowed) {
    throw new PermissionDeniedError();
  }

  return auth;
}

/**
 * المستخدم يحتاج كل الصلاحيات المحددة.
 */
export async function requireAllPermissions(requiredPermissions: string[]) {
  const auth = await requireAuthenticatedUser();

  const allowed = requiredPermissions.every((permission) =>
    auth.user.permissions.includes(permission)
  );

  if (!allowed) {
    throw new PermissionDeniedError();
  }

  return auth;
}