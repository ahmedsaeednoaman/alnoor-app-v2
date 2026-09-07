import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FinancialReviewWorkbench } from "@/components/accounting/financial-review-workbench";
import { getCurrentSession } from "@/lib/auth/session";
import { canonicalReviewQuery, currentCairoMonth } from "@/lib/pagination/monthly";
export const metadata: Metadata = { title: "مراجعة الشغل" };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await getCurrentSession();
  if (!auth) redirect("/login");
  if (!auth.user.permissions.includes("accounting.review")) redirect("/");
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach(item => query.append(key, item));
    else if (value !== undefined) query.set(key, value);
  }
  const defaultMonth = currentCairoMonth();
  const canonical = canonicalReviewQuery(query.toString(), defaultMonth);
  if (canonical !== query.toString()) redirect(`/accounts/review?${canonical}`);
  return <FinancialReviewWorkbench defaultMonth={defaultMonth} canEdit={auth.user.permissions.includes("accounting.finance.edit")} canPay={auth.user.permissions.includes("doctor_accounts.pay")} canPost={auth.user.permissions.includes("doctor_accounts.post")} canManageLayout={auth.user.permissions.includes("accounting.review.layout.manage")}/>;
}
