import { NextResponse } from "next/server";

import { requireAuthenticatedUser } from "@/lib/auth/guards";
import { expenseApiError } from "@/lib/expenses/api";
import { listExpenseCategories } from "@/lib/expenses/service";
import { requestId } from "@/lib/operations/api";

export const runtime = "nodejs";

export async function GET() {
  const id = requestId();
  try {
    const auth = await requireAuthenticatedUser();
    return NextResponse.json(await listExpenseCategories(auth.user));
  } catch (error) {
    return expenseApiError(error, id);
  }
}
