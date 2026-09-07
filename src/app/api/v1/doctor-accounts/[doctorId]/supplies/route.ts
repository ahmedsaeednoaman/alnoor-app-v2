import { NextResponse } from "next/server";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/guards";
import { addDoctorSupplyIssue } from "@/lib/doctor-accounts";
import {
  apiError,
  operationError,
  requestId,
} from "@/lib/operations/api";

const supplyItemSchema = z
  .object({
    sourceType: z.enum([
      "consumable",
      "stent",
      "equipment",
      "manual",
    ]),

    sourceReferenceId: z.string().uuid().nullable().optional(),

    name: z
      .string()
      .trim()
      .min(2)
      .max(200)
      .nullable()
      .optional(),

    quantity: z.number().positive().max(999999),

    unitPrice: z.number().nonnegative().max(999999999.99),

    notes: z
      .string()
      .trim()
      .max(1000)
      .nullable()
      .optional(),
  })
  .superRefine((item, ctx) => {
    if (item.sourceType === "manual") {
      if (!item.name?.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["name"],
          message: "اسم المستلزم اليدوي مطلوب.",
        });
      }

      return;
    }

    if (!item.sourceReferenceId) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceReferenceId"],
        message: "يجب اختيار المستلزم من السجل.",
      });
    }
  });

const schema = z.object({
  occurredAt: z.iso.datetime(),

  notes: z
    .string()
    .trim()
    .max(1000)
    .nullable()
    .optional(),

  idempotencyKey: z.string().uuid(),

  items: z
    .array(supplyItemSchema)
    .min(1)
    .max(100),
});

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      doctorId: string;
    }>;
  },
) {
  const id = requestId();

  try {
    const auth = await requirePermission(
      "doctor_accounts.post",
    );

    const parsed = schema.safeParse(
      await request.json().catch(() => null),
    );

    if (!parsed.success) {
      return apiError(
        400,
        "DOCTOR_SUPPLY_ISSUE_INVALID",
        "بيانات صرف المستلزمات غير صحيحة.",
        id,
        parsed.error.flatten(),
      );
    }

    const { doctorId } = await params;

    const issue = await addDoctorSupplyIssue(
      {
        doctorId,

        // الصحيح هنا occurredAt وليس issuedAt
        occurredAt: parsed.data.occurredAt,

        notes: parsed.data.notes ?? null,

        idempotencyKey:
          parsed.data.idempotencyKey,

        items: parsed.data.items.map((item) => ({
          sourceType: item.sourceType,

          sourceReferenceId:
            item.sourceType === "manual"
              ? null
              : item.sourceReferenceId ?? null,

          name:
            item.sourceType === "manual"
              ? item.name?.trim() ?? null
              : null,

          quantity: item.quantity,

          unitPrice: item.unitPrice,

          notes: item.notes ?? null,
        })),
      },
      auth.user.id,
    );

    return NextResponse.json(
      {
        issue,
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    return operationError(error, id);
  }
}