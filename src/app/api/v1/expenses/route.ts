import { NextResponse } from "next/server";

import { requireAuthenticatedUser } from "@/lib/auth/guards";
import { requestId } from "@/lib/operations/api";
import { expenseApiError, expenseValidationError } from "@/lib/expenses/api";
import { createExpense, listExpenses } from "@/lib/expenses/service";
import {
  expenseCreateSchema,
  expenseFilterSchema,
} from "@/lib/expenses/validation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const id = requestId();
  try {
    const auth = await requireAuthenticatedUser();
    const parsed = expenseFilterSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) {
      return expenseValidationError(
        id,
        "معاملات البحث غير صحيحة.",
        parsed.error.flatten(),
      );
    }
    return NextResponse.json(await listExpenses(parsed.data, auth.user));
  } catch (error) {
    return expenseApiError(error, id);
  }
}

export async function POST(request: Request) {
  const id = requestId();
  try {
    const auth = await requireAuthenticatedUser();
    const parsed = expenseCreateSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return expenseValidationError(
        id,
        "يرجى مراجعة بيانات المصروف.",
        parsed.error.flatten(),
      );
    }
    const result = await createExpense(parsed.data, auth.user);
    return NextResponse.json(result, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    return expenseApiError(error, id);
  }
}
