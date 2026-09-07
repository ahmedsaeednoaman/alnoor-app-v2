import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth/guards";
import { apiError, operationError, requestId } from "@/lib/operations/api";
import { getTemplateVersion } from "@/lib/work-forms/service";
import { operationTypeSchema, versionSchema } from "@/lib/work-forms/validation";
export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ operationType: string; version: string }> }) {
  const id = requestId();
  try {
    await requireAnyPermission(["operations.create", "operations.view"]);
    const values = await params;
    const parsed = operationTypeSchema.safeParse(values.operationType);
    const parsedVersion = versionSchema.safeParse(values.version);
    if (!parsed.success || !parsedVersion.success) return apiError(400, "VALIDATION_ERROR", "نوع العملية أو الإصدار غير صالح.", id);
    const type = parsed.data;
    const version = parsedVersion.data;
    return NextResponse.json({ template: await getTemplateVersion(type, version) });
  } catch (error) {
    return operationError(error, id);
  }
}
