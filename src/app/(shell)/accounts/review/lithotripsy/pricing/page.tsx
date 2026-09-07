import { redirect } from "next/navigation";
import { LithotripsyPricingProfiles } from "@/components/accounting/lithotripsy-pricing-profiles";
import { getCurrentSession } from "@/lib/auth/session";

export default async function LithotripsyPricingPage() {
  const auth = await getCurrentSession();
  if (!auth) redirect("/login");
  if (!auth.user.permissions.includes("accounting.lithotripsy.pricing.manage")) redirect("/accounts/pricing");
  return <LithotripsyPricingProfiles canManage />;
}
