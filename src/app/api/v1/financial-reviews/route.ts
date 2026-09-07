import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guards";
import { apiError, operationError, requestId } from "@/lib/operations/api";
import { financialReviewFilterSchema } from "@/lib/operations/validation";
import { listFinancialReviewRows } from "@/lib/accounting/review";
export async function GET(request: Request) {
  const id = requestId();
  try {
    await requirePermission("accounting.review");
    const parsed = financialReviewFilterSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      return apiError(
        400,
        "VALIDATION_ERROR",
        "معاملات البحث غير صحيحة.",
        id,
        parsed.error.flatten(),
      );
    return NextResponse.json(await listFinancialReviewRows(parsed.data));
  } catch (error) {
    return operationError(error, id);
  }
}
