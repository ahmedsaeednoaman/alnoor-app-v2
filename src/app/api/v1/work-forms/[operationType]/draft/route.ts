import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guards";
import { apiError, operationError, requestId } from "@/lib/operations/api";
import { getOrCreateDraft, mutateDraft } from "@/lib/work-forms/mutations";
import { draftMutationSchema, operationTypeSchema } from "@/lib/work-forms/validation";
export const runtime = "nodejs";
const parseType = (value: string) => operationTypeSchema.safeParse(value);
export async function GET(_request: Request, { params }: { params: Promise<{ operationType: string }> }) {
  const id = requestId();
  try {
    const auth = await requirePermission("settings.work_forms.manage");
    const parsed = parseType((await params).operationType);
    if (!parsed.success) return apiError(400, "VALIDATION_ERROR", "نوع العملية غير صالح.", id);
    return NextResponse.json(await getOrCreateDraft(parsed.data, auth.user.id));
  } catch (error) { return operationError(error, id); }
}
export async function POST(_request: Request, context: { params: Promise<{ operationType: string }> }) {
  return GET(_request, context);
}
export async function PATCH(request: Request, { params }: { params: Promise<{ operationType: string }> }) {
  const id = requestId();
  try {
    const auth = await requirePermission("settings.work_forms.manage");
    const type = parseType((await params).operationType);
    const mutation = draftMutationSchema.safeParse(await request.json().catch(() => null));
    if (!type.success || !mutation.success) return apiError(400, "VALIDATION_ERROR", "بيانات تعديل النموذج غير صالحة.", id, mutation.success ? undefined : mutation.error.flatten());
    return NextResponse.json({ draft: await mutateDraft(type.data, mutation.data, auth.user.id) });
  } catch (error) { return operationError(error, id); }
}
