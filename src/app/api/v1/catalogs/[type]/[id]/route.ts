import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  AuthenticationRequiredError,
  PermissionDeniedError,
  requirePermission,
} from "@/lib/auth/guards";
import {
  getCatalogDefinition,
  type CatalogType,
} from "@/lib/catalogs/definitions";
import {
  CatalogServiceError,
  isUniqueViolation,
  updateCatalogItem,
} from "@/lib/catalogs/service";

export const runtime = "nodejs";

const idSchema = z.string().uuid("معرف العنصر غير صحيح.");

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
        ...(details ? { details } : {}),
      },
    },
    { status },
  );
}

function knownType(value: string): value is CatalogType {
  return getCatalogDefinition(value) !== null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  const requestId = randomUUID();

  try {
    const auth = await requirePermission("catalogs.manage");
    const { type, id } = await params;
    const definition = getCatalogDefinition(type);
    const parsedId = idSchema.safeParse(id);

    if (!definition || !knownType(type)) {
      return apiError(404, "UNKNOWN_CATALOG_TYPE", "نوع القائمة غير مدعوم.", requestId);
    }

    if (!parsedId.success) {
      return apiError(400, "INVALID_CATALOG_ID", "معرف العنصر غير صحيح.", requestId);
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return apiError(400, "INVALID_JSON", "بيانات الطلب غير صحيحة.", requestId);
    }

    const parsed = definition.updateSchema.safeParse(body);

    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      return apiError(
        400,
        "VALIDATION_ERROR",
        "يرجى إرسال حقل واحد صحيح على الأقل.",
        requestId,
        parsed.success ? undefined : parsed.error.flatten(),
      );
    }

    const data = parsed.data as Record<string, unknown>;

    if (
      type === "financial-items" &&
      "defaultAmount" in data &&
      !auth.user.permissions.includes("accounting.finance.edit")
    ) {
      return apiError(
        403,
        "FINANCIAL_PERMISSION_REQUIRED",
        "ليست لديك صلاحية تعديل القيم المالية.",
        requestId,
      );
    }

    const includeFinancialAmount =
      type !== "financial-items" ||
      auth.user.permissions.includes("accounting.finance.view");
    const item = await updateCatalogItem(
      type,
      parsedId.data,
      data,
      includeFinancialAmount,
    );

    return NextResponse.json({ item });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return apiError(401, error.code, "يجب تسجيل الدخول أولاً.", requestId);
    }

    if (error instanceof PermissionDeniedError) {
      return apiError(403, error.code, "ليس لديك صلاحية إدارة القوائم.", requestId);
    }

    if (error instanceof CatalogServiceError) {
      return apiError(error.status, error.code, error.message, requestId);
    }

    if (isUniqueViolation(error)) {
      return apiError(
        409,
        "CATALOG_NAME_ALREADY_EXISTS",
        "يوجد عنصر حالي بنفس الاسم في هذه القائمة.",
        requestId,
      );
    }

    console.error("[CATALOG_UPDATE]", requestId, error);
    return apiError(
      500,
      "INTERNAL_SERVER_ERROR",
      "حدث خطأ أثناء تعديل عنصر القائمة.",
      requestId,
    );
  }
}

