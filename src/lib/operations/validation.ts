import { cairoBusinessDate } from "@/lib/pagination/monthly";
import { z } from "zod";
import { operationTypeSchema } from "@/lib/work-forms/validation";

const nullableUuid = z.string().uuid().nullable().optional();
const nullableText = (max: number) =>
  z.string().trim().max(max).nullable().optional();

export const participantSchema = z
  .object({
    role: z.enum([
      "operator",
      "nurse",
      "assistant",
      "lithotripsy_technician",
      "c_arm_technician",
      "other",
    ]),
    name: z.string().trim().min(2).max(200),
    linkedUserId: nullableUuid,
  })
  .strict();

export const operationInputSchema = z
  .object({
    type: z.enum(["lithotripsy", "endoscopy", "contract"]),
    operationDate: z.iso.date(),
    operationTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    caseName: z.string().trim().min(2).max(250),
    doctorId: nullableUuid,
    hospitalId: nullableUuid,
    contractEntityId: nullableUuid,
    referenceNumber: nullableText(150),
    diagnosis: nullableText(4000),
    notes: nullableText(8000),
    side: z.enum(["right", "left", "bilateral"]).nullable().optional(),
    anesthesiaType: nullableText(120),
    anesthesiologistId: nullableUuid,
    technicianId: nullableUuid,
    sessionCount: z.number().int().min(1).max(100).default(1),
    operationalAmountReceived: z
      .number()
      .finite()
      .nonnegative()
      .nullable()
      .optional(),
    procedureIds: z.array(z.string().uuid()).max(50).default([]),
    equipmentIds: z.array(z.string().uuid()).max(50).default([]),
    consumables: z
      .array(
        z
          .object({
            consumableId: z.string().uuid(),
            quantity: z.number().positive().max(100000).default(1),
            notes: nullableText(1000),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    participants: z.array(participantSchema).max(100).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.type === "contract" &&
      !value.hospitalId &&
      !value.contractEntityId
    ) {
      context.addIssue({
        code: "custom",
        path: ["hospitalId"],
        message: "المستشفى أو جهة التعاقد مطلوبة.",
      });
    }
    if (value.type !== "contract" && !value.doctorId) {
      context.addIssue({
        code: "custom",
        path: ["doctorId"],
        message: "الطبيب مطلوب لهذا النوع.",
      });
    }
  });

const dynamicValueSchema = z.union([
  z.string().max(10000),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(z.string().uuid()).max(100),
]);
export const dynamicOperationInputSchema = z
  .object({
    operationType: operationTypeSchema,
    formTemplateId: z.string().uuid(),
    values: z.record(
      z
        .string()
        .regex(/^[a-z][a-z0-9_]*$/)
        .max(100),
      dynamicValueSchema,
    ),
  })
  .strict();
export const dynamicOperationPatchSchema = z
  .object({
    formTemplateId: z.string().uuid(),
    values: z.record(
      z
        .string()
        .regex(/^[a-z][a-z0-9_]*$/)
        .max(100),
      dynamicValueSchema,
    ),
  })
  .strict();

const legacyOperationFilterFields = {
    type: z.enum(["lithotripsy", "endoscopy", "contract"]).optional(),
    date: z.iso.date().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    doctorId: z.string().uuid().optional(),
    hospitalId: z.string().uuid().optional(),
    search: z.string().trim().max(200).optional(),
};

export const operationFilterSchema = z
  .object({
    ...legacyOperationFilterFields,
    invoiceStatus: z.enum(["all", "pending", "completed", "latest"]).optional(),
    period: z.enum(["week", "month", "year", "custom"]).optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.union([z.literal("all"), z.coerce.number().int().refine(value => [25, 50, 100].includes(value), "حجم الصفحة غير مدعوم.")]).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const issue = (path: keyof typeof value, message: string) => context.addIssue({ code: "custom", path: [path], message });
    if (value.pageSize === "all" && (value.period !== "month" || value.year == null || value.month == null)) issue("pageSize", "عرض الكل يتطلب شهراً وسنة محددين.");
    const legacyPaging = value.limit != null || value.offset != null;
    const numberedPaging = value.page != null || value.pageSize != null;
    if (legacyPaging && numberedPaging) issue("page", "لا يمكن الجمع بين page/pageSize و limit/offset.");
    if (value.date && (value.period || value.from || value.to)) issue("date", "التاريخ المحدد لا يُجمع مع فلاتر الفترة.");
    if (!value.period) {
      if (value.month != null || value.year != null) issue("period", "month/year يتطلبان تحديد period.");
      if ((value.from && !value.to) || (!value.from && value.to)) issue("from", "يجب تحديد بداية ونهاية الفترة معاً.");
      if (value.from && value.to && value.from > value.to) issue("to", "نطاق التاريخ غير صحيح.");
      return;
    }
    if (value.period === "month") {
      if (value.year == null) issue("year", "السنة مطلوبة لفترة الشهر.");
      if (value.month == null) issue("month", "الشهر مطلوب لفترة الشهر.");
      if (value.from || value.to) issue("from", "فترة الشهر لا تقبل from/to.");
    } else if (value.period === "year") {
      if (value.year == null) issue("year", "السنة مطلوبة لفترة السنة.");
      if (value.month != null || value.from || value.to) issue("month", "فترة السنة تقبل year فقط.");
    } else if (value.period === "custom") {
      if (!value.from || !value.to) issue("from", "بداية ونهاية الفترة المخصصة مطلوبتان.");
      if (value.month != null || value.year != null) issue("year", "الفترة المخصصة لا تقبل month/year.");
      if (value.from && value.to && value.from > value.to) issue("to", "نطاق التاريخ غير صحيح.");
    } else if (value.month != null || value.year != null || value.from || value.to) {
      issue("period", "فترة الأسبوع الحالية لا تقبل محددات تاريخ إضافية.");
    }
  });

export const financialReviewFilterSchema = z.object({
  ...legacyOperationFilterFields,
  period: z.enum(["month", "custom"]).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.union([z.literal("all"), z.coerce.number().int().refine(value => [25, 50, 100].includes(value), "حجم الصفحة غير مدعوم.")]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  reviewStatus: z.enum(["awaiting_review", "reviewed", "partially_paid", "paid"]).optional(),
}).strict().superRefine((value, context) => {
  const legacy = value.limit != null || value.offset != null;
  if (legacy && !value.period && value.year == null && value.month == null) {
    if (value.page != null || value.pageSize != null) context.addIssue({ code: "custom", path: ["page"], message: "لا يمكن الجمع بين page/pageSize و limit/offset." });
    if (value.from && value.to && value.from > value.to) context.addIssue({ code: "custom", path: ["to"], message: "نطاق التاريخ غير صحيح." });
    return; // Preserve legacy one-sided/exact-date intersections.
  }
  const { reviewStatus: _reviewStatus, ...canonical } = value;
  void _reviewStatus;
  const parsed = operationFilterSchema.safeParse(canonical);
  if (!parsed.success) for (const issue of parsed.error.issues) context.addIssue({ code: "custom", path: issue.path, message: issue.message });
});

export function resolveFinancialReviewPagination(filters: FinancialReviewFilters, now = new Date()): ResolvedOperationPagination {
  if ((filters.limit != null || filters.offset != null) && !filters.period) {
    const starts = [filters.from, filters.date].filter((value): value is string => Boolean(value)).sort();
    const ends = [filters.to, filters.date].filter((value): value is string => Boolean(value)).sort();
    const from = starts.at(-1) ?? null, to = ends[0] ?? null;
    const pageSize = filters.limit ?? 50, offset = filters.offset ?? 0;
    return { period: from || to ? "custom" : null, from, to, toExclusive: to ? addCalendarDays(to, 1) : null, page: Math.floor(offset / pageSize) + 1, pageSize, offset, legacyPaging: true };
  }
  return resolveOperationPagination(filters, now);
}

export type OperationPeriod = "week" | "month" | "year" | "custom";
export type ResolvedOperationPagination = {
  period: OperationPeriod | null;
  from: string | null;
  to: string | null;
  toExclusive: string | null;
  page: number;
  pageSize: number | "all";
  offset: number;
  legacyPaging: boolean;
};

export function operationPaginationMetadata(total: number, resolved: ResolvedOperationPagination) {
  if (resolved.pageSize === "all") return { page: 1, pageSize: "all" as const, total, totalPages: total > 0 ? 1 : 0, hasNext: false, hasPrevious: false };
  const totalPages = total === 0 ? 0 : Math.ceil(total / resolved.pageSize);
  return {
    page: resolved.page,
    pageSize: resolved.pageSize,
    total,
    totalPages,
    hasNext: resolved.page < totalPages,
    hasPrevious: resolved.page > 1,
  };
}

function dateParts(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function calendarDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function addCalendarDays(value: string, days: number) {
  const { year, month, day } = dateParts(value);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function resolveOperationPagination(
  filters: OperationFilters,
  now = new Date(),
): ResolvedOperationPagination {
  const today = cairoBusinessDate(now);
  const current = dateParts(today);
  const legacyPaging = filters.limit != null || filters.offset != null;
  let period: OperationPeriod | null;
  let from: string | null;
  let toExclusive: string | null;

  if (filters.date) {
    period = "custom";
    from = filters.date;
    toExclusive = addCalendarDays(filters.date, 1);
  } else if (!filters.period && filters.from && filters.to) {
    period = "custom";
    from = filters.from;
    toExclusive = addCalendarDays(filters.to, 1);
  } else if (!filters.period && legacyPaging) {
    period = null;
    from = null;
    toExclusive = null;
  } else if ((filters.period ?? "month") === "week") {
    period = "week";
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    from = addCalendarDays(today, -((weekday + 1) % 7));
    toExclusive = addCalendarDays(from, 7);
  } else if ((filters.period ?? "month") === "year") {
    period = "year";
    const year = filters.year!;
    from = calendarDate(year, 1, 1);
    toExclusive = calendarDate(year + 1, 1, 1);
  } else if ((filters.period ?? "month") === "custom") {
    period = "custom";
    from = filters.from!;
    toExclusive = addCalendarDays(filters.to!, 1);
  } else {
    period = "month";
    const year = filters.period ? filters.year! : current.year;
    const month = filters.period ? filters.month! : current.month;
    from = calendarDate(year, month, 1);
    toExclusive = calendarDate(year, month + 1, 1);
  }

  const pageSize = legacyPaging ? (filters.limit ?? 50) : (filters.pageSize ?? 25);
  if (pageSize === "all") return { period, from, to: toExclusive ? addCalendarDays(toExclusive, -1) : null, toExclusive, page: 1, pageSize, offset: 0, legacyPaging };
  const offset = legacyPaging ? (filters.offset ?? 0) : ((filters.page ?? 1) - 1) * pageSize;
  const page = legacyPaging ? Math.floor(offset / pageSize) + 1 : (filters.page ?? 1);
  return { period, from, to: toExclusive ? addCalendarDays(toExclusive, -1) : null, toExclusive, page, pageSize, offset, legacyPaging };
}
const reviewMoneySchema = z
  .union([
    z.number().finite().nonnegative(),
    z
      .string()
      .trim()
      .regex(/^\d+(?:\.\d{1,2})?$/),
  ])
  .transform((value) => Number(value).toFixed(2));
const reviewSignedMoneySchema = z
  .union([
    z.number().finite(),
    z.string().trim().regex(/^-?\d+(?:\.\d{1,2})?$/),
  ])
  .transform((value) => Number(value).toFixed(2));
export const financialReviewSchema = z
  .object({
    expectedUpdatedAt: z.iso.datetime().nullable(),
    accountingMode: z.enum(["main_amount", "direct_items"]).optional().default("main_amount"),
    mainAmount: reviewMoneySchema.optional().nullable(),
    doctorReceivedAmount: reviewMoneySchema.optional().nullable(),
    doctorAccountAmount: reviewMoneySchema.optional().nullable(),
    doctorBalanceReceived: z.boolean().optional().default(false),
    notes: nullableText(4000),
    items: z
      .array(
        z
          .object({
            catalogItemId: nullableUuid,
            kind: z.enum(["financial", "note"]),
            financialEffect: z.enum(["add", "subtract", "neutral"]),
            sourceType: z
              .enum([
                "dynamic_field",
                "anesthesiologist",
                "technician",
                "procedure",
                "equipment",
                "consumable",
                "stent",
                "manual",
                "other",
              ])
              .default("manual"),
            sourceFieldId: nullableUuid,
            sourceReferenceId: nullableUuid,
            definitionId: nullableUuid,
            pricingProfileId: nullableUuid,
            pricingProfileLineId: nullableUuid,
            pricingProfileVersion: z.number().int().positive().nullable().optional(),
            servicePricingProfileId: nullableUuid,
            servicePricingItemId: nullableUuid,
            servicePricingVersion: z.number().int().positive().nullable().optional(),
            baseAmount: reviewMoneySchema.nullable().optional(),
            adjustmentAmount: reviewSignedMoneySchema.nullable().optional(),
            effectiveAmount: reviewMoneySchema.nullable().optional(),
            caseLineState: z.enum(["included", "excluded"]).optional().default("included"),
            description: z.string().trim().min(1).max(250),
            amount: reviewMoneySchema.nullable().optional(),
            notes: nullableText(2000),
          })
          .strict()
          .superRefine((item, context) => {
            if (item.kind === "financial" && item.caseLineState !== "excluded" && item.amount == null)
              context.addIssue({
                code: "custom",
                path: ["amount"],
                message: "المبلغ مطلوب.",
              });
            if (item.kind === "financial" && item.baseAmount != null && item.adjustmentAmount != null) {
              const effective = Number(item.effectiveAmount ?? item.amount ?? 0);
              if (Number(item.baseAmount) + Number(item.adjustmentAmount) !== effective)
                context.addIssue({ code: "custom", path: ["effectiveAmount"], message: "القيمة الفعالة يجب أن تساوي السعر الأساسي مضافاً إليه تعديل الحالة." });
              if (effective < 0) context.addIssue({ code: "custom", path: ["adjustmentAmount"], message: "لا يمكن أن تصبح قيمة البند أقل من صفر." });
            }
            if (item.kind === "note" && item.amount != null)
              context.addIssue({
                code: "custom",
                path: ["amount"],
                message: "البند النصي لا يحمل مبلغاً.",
              });
            if (item.kind === "note" && item.financialEffect !== "neutral")
              context.addIssue({
                code: "custom",
                path: ["financialEffect"],
                message: "الملاحظة يجب أن تكون محايدة.",
              });
            if (item.sourceType === "dynamic_field" && !item.sourceFieldId)
              context.addIssue({
                code: "custom",
                path: ["sourceFieldId"],
                message: "مصدر الحقل مطلوب.",
              });
          }),
      )
      .max(100)
      .default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.accountingMode === "main_amount" && value.mainAmount == null)
      context.addIssue({ code: "custom", path: ["mainAmount"], message: "المبلغ الرئيسي مطلوب في هذا الوضع." });
  });

export const paymentSchema = z
  .object({
    amount: z.number().finite().positive(),
    notes: nullableText(2000),
  })
  .strict();

export const cancelSchema = z
  .object({ reason: z.string().trim().min(3).max(2000) })
  .strict();
export type OperationInput = z.infer<typeof operationInputSchema>;
export type DynamicOperationInput = z.infer<typeof dynamicOperationInputSchema>;
export type DynamicOperationPatch = z.infer<typeof dynamicOperationPatchSchema>;
export type OperationFilters = z.infer<typeof operationFilterSchema>;
export type FinancialReviewFilters = z.infer<
  typeof financialReviewFilterSchema
>;
export type FinancialReviewInput = z.infer<typeof financialReviewSchema>;
