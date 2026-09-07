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
  createCatalogItem,
  isUniqueViolation,
  listCatalog,
} from "@/lib/catalogs/service";

export const runtime = "nodejs";

const querySchema = z.object({
  search: z.string().trim().max(200).optional(),
  active: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  tab: z.enum(["archived"]).optional(),
  cursor: z.string().uuid("مؤشر الصفحة غير صحيح.").optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
}).strict();

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

function errorResponse(error: unknown, requestId: string, action: string) {
  if (error instanceof AuthenticationRequiredError) {
    return apiError(401, error.code, "يجب تسجيل الدخول أولاً.", requestId);
  }

  if (error instanceof PermissionDeniedError) {
    return apiError(403, error.code, "ليس لديك الصلاحية المطلوبة.", requestId);
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

  console.error(`[CATALOG_${action}]`, requestId, error);
  return apiError(
    500,
    "INTERNAL_SERVER_ERROR",
    "حدث خطأ أثناء تنفيذ عملية القائمة.",
    requestId,
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ type: string }> },
) {
  const requestId = randomUUID();

  try {
    const auth = await requirePermission("catalogs.view");
    const { type } = await params;

    if (!knownType(type)) {
      return apiError(404, "UNKNOWN_CATALOG_TYPE", "نوع القائمة غير مدعوم.", requestId);
    }

    const rawQuery = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = querySchema.safeParse(rawQuery);

    if (!parsed.success) {
      return apiError(
        400,
        "VALIDATION_ERROR",
        "معاملات البحث غير صحيحة.",
        requestId,
        parsed.error.flatten(),
      );
    }

    const includeFinancialAmount =
      type !== "financial-items" ||
      auth.user.permissions.includes("accounting.finance.view");

    const result = await listCatalog(
      type,
      {
        ...parsed.data,
        archived: parsed.data.tab === "archived",
      },
      includeFinancialAmount,
    );
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, requestId, "LIST");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ type: string }> },
) {
  const requestId = randomUUID();

  try {
    const auth = await requirePermission("catalogs.manage");
    const { type } = await params;
    const definition = getCatalogDefinition(type);

    if (!definition || !knownType(type)) {
      return apiError(404, "UNKNOWN_CATALOG_TYPE", "نوع القائمة غير مدعوم.", requestId);
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return apiError(400, "INVALID_JSON", "بيانات الطلب غير صحيحة.", requestId);
    }

    const parsed = definition.createSchema.safeParse(body);

    if (!parsed.success) {
      return apiError(
        400,
        "VALIDATION_ERROR",
        "يرجى مراجعة البيانات المدخلة.",
        requestId,
        parsed.error.flatten(),
      );
    }

    const data = parsed.data as Record<string, unknown>;

    if (
      type === "financial-items" &&
      data.defaultAmount != null &&
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
    const item = await createCatalogItem(
      type,
      data,
      auth.user.id,
      includeFinancialAmount,
    );

    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return errorResponse(error, requestId, "CREATE");
  }
}

