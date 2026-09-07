import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guards";
import { operationTypeSchema } from "@/lib/work-forms/validation";
import { listLithotripsyPricing, mutateLithotripsyPricing } from "@/lib/accounting/lithotripsy-pricing";
import { operationError, requestId } from "@/lib/operations/api";

export async function GET(_request: Request, { params }: { params: Promise<{ operationType: string }> }) {
  const id = requestId();
  try {
    await requirePermission("accounting.review");
    const type = operationTypeSchema.parse((await params).operationType);
    if (type !== "lithotripsy") return NextResponse.json({ definitions: [] });
    return NextResponse.json({ definitions: await listLithotripsyPricing() });
  } catch (error) { return operationError(error, id); }
}
export async function PATCH(request: Request, { params }: { params: Promise<{ operationType: string }> }) {
  const id = requestId();
  try {
    const auth = await requirePermission("accounting.lithotripsy.pricing.manage");
    const type = operationTypeSchema.parse((await params).operationType);
    if (type !== "lithotripsy") return NextResponse.json({ definitions: [] });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body?.action) return NextResponse.json({ error: { message: "إجراء التسعير مطلوب." } }, { status: 400 });
    return NextResponse.json({ definitions: await mutateLithotripsyPricing(String(body.action), body, auth.user.id) });
  } catch (error) { return operationError(error, id); }
}
