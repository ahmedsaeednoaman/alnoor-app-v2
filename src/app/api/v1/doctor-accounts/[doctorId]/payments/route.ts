import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { addDoctorPayment } from "@/lib/doctor-accounts";
import { apiError, operationError, requestId } from "@/lib/operations/api";

const schema = z.object({ amount: z.number().positive().max(999999999.99), paidAt: z.iso.datetime(), notes: z.string().trim().max(1000).nullable().optional(), idempotencyKey: z.string().uuid() });
export async function POST(request: Request, { params }: { params: Promise<{ doctorId: string }> }) {
  const id = requestId();
  try {
    const auth = await requirePermission("doctor_accounts.pay");
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiError(400,"DOCTOR_PAYMENT_INVALID","بيانات الدفعة غير صحيحة.",id,parsed.error.flatten());
    return NextResponse.json({ payment: await addDoctorPayment({ ...parsed.data, doctorId: (await params).doctorId }, auth.user.id) }, { status: 201 });
  } catch (error) { return operationError(error,id); }
}
