import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { operationError, requestId, apiError } from "@/lib/operations/api";
import { listLithotripsyProfiles, createLithotripsyProfile } from "@/lib/accounting/lithotripsy-profiles";

export const lithotripsyProfileInputSchema = z.object({
  name: z.string().trim().min(2),
  sessionId: z.uuid().optional(),
  sessionNumber: z.number().int().positive().optional(),
  procedureIds: z.array(z.uuid()).min(1),
  isBase: z.boolean().optional(),
  lines: z.array(z.object({
    stableKey: z.string().optional(),
    lineType: z.enum(["linked_role", "linked_source", "fixed_cost", "session_cost"]),
    label: z.string(),
    defaultAmount: z.union([z.number(), z.string(), z.null()]).optional(),
    effect: z.enum(["add", "subtract", "neutral"]).optional(),
    sourceType: z.string().nullable().optional(),
    sourceReferenceId: z.uuid().nullable().optional(),
    sessionValue: z.union([z.literal(1), z.literal(2), z.null()]).optional(),
    pricingDefinitionId: z.uuid().nullable().optional(),
  })),
}).refine((value) => value.sessionId != null || value.sessionNumber != null);

export const runtime = "nodejs";

export async function GET() {
  const id = requestId();
  try {
    await requirePermission("accounting.review");
    return NextResponse.json({ profiles: await listLithotripsyProfiles() });
  } catch (error) { return operationError(error, id); }
}

export async function POST(request: Request) {
  const id = requestId();
  try {
    const auth = await requirePermission("accounting.lithotripsy.pricing.manage");
    const parsed = lithotripsyProfileInputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiError(400, "LITHO_PROFILE_INPUT_INVALID", "اسم القالب والجلسة والإجراءات والبنود مطلوبة بشكل صحيح.", id);
    const profile = await createLithotripsyProfile(parsed.data, auth.user.id);
    return NextResponse.json({ profile }, { status: 201 });
  } catch (error) { return operationError(error, id); }
}
