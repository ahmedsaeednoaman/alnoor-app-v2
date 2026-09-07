import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ExpensesList } from "@/components/expenses/expenses-list";
import { getCurrentSession } from "@/lib/auth/session";
import { canCreatePersonalExpense } from "@/lib/expenses/service";

export const metadata: Metadata = { title: "المصاريف" };

export default async function Page() {
  const auth = await getCurrentSession();
  if (!auth) redirect("/login");
  const canCreate = canCreatePersonalExpense(auth.user);
  const canView = auth.user.permissions.includes("expenses.view");
  const isOwner = auth.user.role.code === "owner";
  if (!isOwner && !canCreate && !canView) redirect("/");
  return <ExpensesList canCreate={canCreate} isOwner={isOwner} />;
}
