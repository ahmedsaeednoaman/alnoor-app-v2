import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { AuthenticationRequiredError, PermissionDeniedError } from "@/lib/auth/guards";
import { WorkFormDomainError } from "@/lib/work-forms/validation";

export function requestId() { return randomUUID(); }
export function apiError(status: number, code: string, message: string, id: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, requestId: id, ...(details ? { details } : {}) } }, { status });
}
export function operationError(error: unknown, id: string) {
  if (error instanceof AuthenticationRequiredError) return apiError(401, error.code, "يجب تسجيل الدخول أولاً.", id);
  if (error instanceof PermissionDeniedError) return apiError(403, error.code, "ليس لديك الصلاحية المطلوبة.", id);
  if (error instanceof OperationDomainError) return apiError(error.status, error.code, error.message, id);
  if (error instanceof WorkFormDomainError) return apiError(error.status, error.code, error.message, id, error.details);
  console.error("[OPERATIONS]", id, error);
  return apiError(500, "INTERNAL_SERVER_ERROR", "حدث خطأ غير متوقع.", id);
}
export class OperationDomainError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = "OperationDomainError"; }
}
