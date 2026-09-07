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
} from "./definitions";
import {
  CatalogServiceError,
  isUniqueViolation,
  setCatalogArchived,
} from "./service";

const idSchema = z.string().uuid();

function apiError(
  status: number,
  code: string,
  message: string,
  requestId: string,
) {
  return NextResponse.json(
    { error: { code, message, requestId } },
    { status },
  );
}

function knownType(value: string): value is CatalogType {
  return getCatalogDefinition(value) !== null;
}

export async function handleCatalogLifecycle(
  paramsPromise: Promise<{ type: string; id: string }>,
  archived: boolean,
) {
  const requestId = randomUUID();

  try {
    const auth = await requirePermission("catalogs.manage");
    const { type, id } = await paramsPromise;

    if (!knownType(type)) {
      return apiError(404, "UNKNOWN_CATALOG_TYPE", "نوع القائمة غير مدعوم.", requestId);
    }

    if (!idSchema.safeParse(id).success) {
      return apiError(400, "INVALID_CATALOG_ID", "معرف العنصر غير صحيح.", requestId);
    }

    const includeFinancialAmount =
      type !== "financial-items" ||
      auth.user.permissions.includes("accounting.finance.view");
    const item = await setCatalogArchived(
      type,
      id,
      archived,
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
        "CATALOG_RESTORE_NAME_CONFLICT",
        "لا يمكن استعادة العنصر لوجود عنصر حالي بنفس الاسم.",
        requestId,
      );
    }

    console.error(
      archived ? "[CATALOG_ARCHIVE]" : "[CATALOG_RESTORE]",
      requestId,
      error,
    );
    return apiError(
      500,
      "INTERNAL_SERVER_ERROR",
      archived
        ? "حدث خطأ أثناء أرشفة العنصر."
        : "حدث خطأ أثناء استعادة العنصر.",
      requestId,
    );
  }
}

