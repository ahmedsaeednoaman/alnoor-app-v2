import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ExpenseForm } from "@/components/expenses/expense-form";
import { getCurrentSession } from "@/lib/auth/session";
import { canCreatePersonalExpense } from "@/lib/expenses/service";

export const metadata: Metadata = { title: "إضافة مصروف" };

export default async function Page() {
  const auth = await getCurrentSession();
  if (!auth) redirect("/login");
  if (!canCreatePersonalExpense(auth.user)) redirect("/");
  return <main className="expense-new-page" dir="rtl"><ExpenseForm /></main>;
}
