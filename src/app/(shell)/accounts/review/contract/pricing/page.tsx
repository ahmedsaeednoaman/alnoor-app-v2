import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { ServicePricingLibrary } from "@/components/accounting/service-pricing-library";
export const metadata: Metadata = { title: "قوائم أسعار التعاقد" };
export default async function Page() { const auth = await getCurrentSession(); if (!auth) redirect("/login"); if (!auth.user.permissions.includes("accounting.contract.pricing.manage")) redirect("/accounts/pricing"); return <ServicePricingLibrary type="contract"/>; }
