import { NextResponse } from "next/server";

import {
  AuthenticationRequiredError,
  PermissionDeniedError,
} from "@/lib/auth/guards";
import { apiError } from "@/lib/operations/api";

import { ExpenseDomainError } from "./service";

export function expenseApiError(error: unknown, requestId: string) {
  if (error instanceof AuthenticationRequiredError) {
    return apiError(401, error.code, "يجب تسجيل الدخول أولاً.", requestId);
  }
  if (error instanceof PermissionDeniedError) {
    return apiError(403, error.code, "ليس لديك الصلاحية المطلوبة.", requestId);
  }
  if (error instanceof ExpenseDomainError) {
    return apiError(error.status, error.code, error.message, requestId);
  }
  console.error("[EXPENSES]", requestId, error);
  return apiError(
    500,
    "INTERNAL_SERVER_ERROR",
    "حدث خطأ غير متوقع.",
    requestId,
  );
}

export function expenseValidationError(
  requestId: string,
  message: string,
  details: unknown,
) {
  return NextResponse.json(
    {
      error: {
        code: "VALIDATION_ERROR",
        message,
        requestId,
        details,
      },
    },
    { status: 400 },
  );
}
