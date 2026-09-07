import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OperationsList } from "@/components/operations/operations-list";
import { getCurrentSession } from "@/lib/auth/session";
import { currentCairoMonth } from "@/lib/pagination/monthly";
import { canonicalOperationsQuery } from "@/lib/operations/list-query";

export const metadata: Metadata = { title: "عرض العمليات" };
export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await getCurrentSession();
  if (!auth) redirect("/login");
  if (!auth.user.permissions.includes("operations.view")) redirect("/");
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach(item => query.append(key, item));
    else if (value !== undefined) query.set(key, value);
  }
  const defaultMonth = currentCairoMonth();
  const canonical = canonicalOperationsQuery(query.toString(), defaultMonth);
  // Redirect before mounting the list: no initial API request with implicit scope.
  if (canonical !== query.toString()) redirect(`/operations?${canonical}`);
  return <OperationsList defaultMonth={defaultMonth} canCreateInvoice={auth.user.permissions.includes("accounting.finance.edit")} canEditAll={auth.user.permissions.includes("operations.edit") && auth.user.role.code !== "employee"} isEmployee={auth.user.role.code === "employee"}/>;
}
