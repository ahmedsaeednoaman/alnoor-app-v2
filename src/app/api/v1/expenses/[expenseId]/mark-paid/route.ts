import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthenticatedUser } from "@/lib/auth/guards";
import { expenseApiError, expenseValidationError } from "@/lib/expenses/api";
import { markExpensePaid } from "@/lib/expenses/service";
import { requestId } from "@/lib/operations/api";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ expenseId: string }> },
) {
  const id = requestId();
  try {
    const auth = await requireAuthenticatedUser();
    const parsed = z.string().uuid().safeParse((await params).expenseId);
    if (!parsed.success) {
      return expenseValidationError(id, "معرّف المصروف غير صحيح.", parsed.error.flatten());
    }
    return NextResponse.json(await markExpensePaid(parsed.data, auth.user));
  } catch (error) {
    return expenseApiError(error, id);
  }
}
