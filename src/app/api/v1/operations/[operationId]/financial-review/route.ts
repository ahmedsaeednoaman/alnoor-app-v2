import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guards";
import { apiError, operationError, requestId } from "@/lib/operations/api";
import { financialReviewSchema } from "@/lib/operations/validation";
import {
  getFinancialReviewOperation,
  saveFinancialReview,
} from "@/lib/accounting/review";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ operationId: string }> },
) {
  const id = requestId();
  try {
    const auth = await requirePermission("accounting.review");
    return NextResponse.json(
      await getFinancialReviewOperation((await params).operationId, auth.user),
    );
  } catch (error) {
    return operationError(error, id);
  }
}
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ operationId: string }> },
) {
  const id = requestId();
  try {
    const auth = await requirePermission("accounting.finance.edit");
    const parsed = financialReviewSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return apiError(
        400,
        "VALIDATION_ERROR",
        "يرجى مراجعة القيم المالية.",
        id,
        parsed.error.flatten(),
      );
    const review = await saveFinancialReview(
      (await params).operationId,
      parsed.data,
      auth.user,
    );
    return NextResponse.json({ review });
  } catch (error) {
    return operationError(error, id);
  }
}
