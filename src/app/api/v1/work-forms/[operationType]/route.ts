import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth/guards";
import { apiError, operationError, requestId } from "@/lib/operations/api";
import { getPublishedTemplate } from "@/lib/work-forms/service";
import { operationTypeSchema } from "@/lib/work-forms/validation";
export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ operationType: string }> }) {
  const id = requestId();
  try {
    await requireAnyPermission(["operations.create", "operations.view"]);
    const parsed = operationTypeSchema.safeParse((await params).operationType);
    if (!parsed.success) return apiError(400, "VALIDATION_ERROR", "نوع العملية غير صالح.", id, parsed.error.flatten());
    const type = parsed.data;
    const template=await getPublishedTemplate(type);
    const operational={...template,sections:template.sections.map(section=>{const safeSection={...section} as Record<string,unknown>;delete safeSection.isSystemSection;safeSection.fields=section.fields.map(field=>{const safeField={...field};delete safeField.isSystemField;delete safeField.showInDetails;delete safeField.showInFinancialReview;delete safeField.showInPrint;delete safeField.isFinancial;delete safeField.financialEffect;return safeField});return safeSection})};
    return NextResponse.json({ template: operational });
  } catch (error) {
    return operationError(error, id);
  }
}
