import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { apiError, operationError, requestId } from "@/lib/operations/api";
import { getContractMonthlyReport } from "@/lib/printing/projection";

const querySchema = z.object({ month: z.coerce.number().int().min(1).max(12), year: z.coerce.number().int().min(2000).max(2200), hospitalId: z.string().uuid().optional(), contractEntityId: z.string().uuid().optional(), search: z.string().trim().max(100).optional() });
export const runtime = "nodejs";
export async function GET(request: Request) {
  const id = requestId();
  try {
    const auth = await requirePermission("reports.view");
    if (!auth.user.permissions.includes("accounting.finance.view")) return apiError(403, "FINANCIAL_PRINT_DENIED", "تحتاج هذه التقارير إلى صلاحية عرض البيانات المالية.", id);
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return apiError(400, "VALIDATION_ERROR", "يرجى اختيار شهر وسنة صحيحين.", id, parsed.error.flatten());
    return NextResponse.json(await getContractMonthlyReport(parsed.data, auth.user));
  } catch (error) { return operationError(error, id); }
}
