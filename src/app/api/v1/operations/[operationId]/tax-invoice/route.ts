import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAllPermissions } from "@/lib/auth/guards";
import { apiError, operationError, requestId } from "@/lib/operations/api";
import { createTaxInvoice } from "@/lib/operations/tax-invoice-service";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ operationId: string }> }) {
  const id = requestId();
  try {
    const auth = await requireAllPermissions(["operations.view", "accounting.finance.edit"]);
    const { operationId } = await params;
    if (!z.uuid().safeParse(operationId).success) return apiError(400, "VALIDATION_ERROR", "معرف الحالة غير صحيح.", id);
    const taxInvoice = await createTaxInvoice(operationId, await request.json().catch(() => null), auth.user);
    return NextResponse.json({ taxInvoice });
  } catch (error) { return operationError(error, id); }
}
