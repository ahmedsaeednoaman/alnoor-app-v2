import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guards";
import { operationTypeSchema } from "@/lib/work-forms/validation";
import { ensureFinancialReviewLayout, getOperationFieldSources, mutateFinancialReviewLayout } from "@/lib/accounting/layout";
import { apiError, operationError, requestId } from "@/lib/operations/api";

export async function GET(_request: Request, { params }: { params: Promise<{ operationType: string }> }) {
  const id = requestId();
  try {
    const auth = await requirePermission("accounting.review");
    const type = operationTypeSchema.parse((await params).operationType);
    const layout = await ensureFinancialReviewLayout(type, auth.user.id);
    const fields = await getOperationFieldSources(type);
    return NextResponse.json({ layout, operationFields: fields });
  } catch (error) { return operationError(error, id); }
}
export async function PATCH(request: Request, { params }: { params: Promise<{ operationType: string }> }) {
  const id = requestId();
  try {
    const auth = await requirePermission("accounting.review.layout.manage");
    const type = operationTypeSchema.parse((await params).operationType);
    const body = await request.json().catch(() => null) as { action?: string; [key: string]: unknown } | null;
    if (!body?.action) return apiError(400, "LAYOUT_ACTION_REQUIRED", "إجراء إعداد الجدول مطلوب.", id);
    const layout = await mutateFinancialReviewLayout(type, body.action, body, auth.user.id);
    return NextResponse.json({ layout });
  } catch (error) { return operationError(error, id); }
}
