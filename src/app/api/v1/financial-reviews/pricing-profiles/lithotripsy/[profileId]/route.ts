import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guards";
import { operationError, requestId, apiError } from "@/lib/operations/api";
import { archiveLithotripsyProfile, restoreLithotripsyProfile, updateLithotripsyProfile } from "@/lib/accounting/lithotripsy-profiles";
import { lithotripsyProfileInputSchema } from "../route";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ profileId: string }> }) {
  const id = requestId();
  try {
    const auth = await requirePermission("accounting.lithotripsy.pricing.manage");
    const profileId = (await params).profileId;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body?.action) return apiError(400, "LITHO_PROFILE_ACTION_REQUIRED", "إجراء القالب مطلوب.", id);
    if (body.action === "archive") return NextResponse.json({ profile: await archiveLithotripsyProfile(profileId, auth.user.id) });
    if (body.action === "restore") return NextResponse.json({ profile: await restoreLithotripsyProfile(profileId, auth.user.id) });
    if (body.action !== "update") return apiError(400, "LITHO_PROFILE_INPUT_INVALID", "بيانات القالب غير مكتملة.", id);
    const parsed = lithotripsyProfileInputSchema.safeParse(body);
    if (!parsed.success) return apiError(400, "LITHO_PROFILE_INPUT_INVALID", "اسم القالب والجلسة والإجراءات والبنود مطلوبة بشكل صحيح.", id);
    return NextResponse.json({ profile: await updateLithotripsyProfile(profileId, parsed.data, auth.user.id) });
  } catch (error) { return operationError(error, id); }
}
