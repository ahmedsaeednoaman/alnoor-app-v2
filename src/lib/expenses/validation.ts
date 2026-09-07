import { z } from "zod";

export const MAX_EXPENSE_AMOUNT = "999999999.99";
export const MAX_EXPENSE_RANGE_DAYS = 366;
export const EXPENSE_PAGE_SIZES = [7, 14, 30] as const;

const moneyPattern = /^\d{1,9}(?:\.\d{1,2})?$/;

function canonicalMoney(value: string | number) {
  const text = typeof value === "number" ? String(value) : value.trim();
  if (!moneyPattern.test(text)) return null;

  const [integer, fraction = ""] = text.split(".");
  const hundred = BigInt(100);
  const cents = BigInt(integer) * hundred + BigInt(fraction.padEnd(2, "0"));
  if (cents <= BigInt(0) || cents > BigInt("99999999999")) return null;

  return `${cents / hundred}.${String(cents % hundred).padStart(2, "0")}`;
}

const expenseMoneySchema = z
  .union([z.string(), z.number().finite()])
  .transform((value, context) => {
    const amount = canonicalMoney(value);
    if (!amount) {
      context.addIssue({
        code: "custom",
        message: `المبلغ يجب أن يكون أكبر من صفر، بحد أقصى منزلتان عشريتان، وألا يتجاوز ${MAX_EXPENSE_AMOUNT}.`,
      });
      return z.NEVER;
    }
    return amount;
  });

const optionalTrimmedText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => value || null);

export const expenseCreateSchema = z
  .object({
    amount: expenseMoneySchema,
    description: z.string().trim().min(2).max(500),
    notes: optionalTrimmedText(4000),
    idempotencyKey: z.string().trim().min(8).max(120),
  })
  .strict();

export const expenseFilterSchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    employeeId: z.string().uuid().optional(),
    categoryId: z.string().uuid().optional(),
    search: z.string().trim().max(200).optional(),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    status: z.enum(["unpaid", "paid", "all"]).default("unpaid"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .pipe(z.union([z.literal(7), z.literal(14), z.literal(30)]))
      .default(7),
  })
  .strict()
  .refine((value) => !value.month || (!value.from && !value.to), {
    message: "لا يمكن الجمع بين الشهر ونطاق تاريخ مخصص.",
    path: ["month"],
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: "تاريخ البداية يجب ألا يكون بعد تاريخ النهاية.",
    path: ["to"],
  });

export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>;
export type ExpenseFilters = z.infer<typeof expenseFilterSchema>;
