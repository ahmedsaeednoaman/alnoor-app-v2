import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guards";
import { apiError, operationError, requestId } from "@/lib/operations/api";
import { publishDraft } from "@/lib/work-forms/mutations";
import { operationTypeSchema, publishDraftSchema } from "@/lib/work-forms/validation";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ operationType: string }> }) {
  const id = requestId();
  try {
    const auth = await requirePermission("settings.work_forms.manage");
    const type = operationTypeSchema.safeParse((await params).operationType);
    const body = publishDraftSchema.safeParse(await request.json().catch(() => null));
    if (!type.success || !body.success) return apiError(400, "VALIDATION_ERROR", "بيانات النشر غير صالحة.", id);
    return NextResponse.json({ published: await publishDraft(type.data, body.data.expectedUpdatedAt, auth.user.id) });
  } catch (error) { return operationError(error, id); }
}
