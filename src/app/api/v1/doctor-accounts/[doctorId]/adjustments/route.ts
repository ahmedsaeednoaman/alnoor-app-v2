import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { addDoctorAdjustment } from "@/lib/doctor-accounts";
import { apiError, operationError, requestId } from "@/lib/operations/api";

const schema = z.object({ direction: z.enum(["debit", "credit"]), amount: z.number().positive().max(999999999.99), occurredAt: z.iso.datetime(), description: z.string().trim().min(2).max(240), notes: z.string().trim().max(1000).nullable().optional(), idempotencyKey: z.string().uuid() });
export async function POST(request: Request, { params }: { params: Promise<{ doctorId: string }> }) {
  const id = requestId();
  try {
    const auth = await requirePermission("doctor_accounts.post");
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiError(400,"DOCTOR_ADJUSTMENT_INVALID","بيانات الحركة غير صحيحة.",id,parsed.error.flatten());
    return NextResponse.json({ adjustment: await addDoctorAdjustment({ ...parsed.data, doctorId: (await params).doctorId }, auth.user.id) }, { status: 201 });
  } catch (error) { return operationError(error,id); }
}
