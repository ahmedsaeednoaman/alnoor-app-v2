import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { ContractMonthlyReport } from "@/components/printing/contract-monthly-report";
export default async function Page() {
  const auth = await getCurrentSession();
  if (!auth) redirect("/login");
  if (!auth.user.permissions.includes("reports.view")) redirect("/");
  return <ContractMonthlyReport />;
}
