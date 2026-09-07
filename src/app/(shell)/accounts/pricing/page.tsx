import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { listLithotripsyProfiles } from "@/lib/accounting/lithotripsy-profiles";
import { listLithotripsySessions } from "@/lib/accounting/lithotripsy-sessions";
import { listServicePricing } from "@/lib/accounting/service-pricing";
import { getCurrentSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "بنود وأسعار",
  description: "المركز الموحد لإدارة أسعار التفتيت والتعاقد والمناظير.",
};

type PricingDomain = {
  key: "lithotripsy" | "contract" | "endoscopy";
  title: string;
  description: string;
  href: string;
  action: string;
  summary: string;
};

export default async function PricingHubPage() {
  const auth = await getCurrentSession();
  if (!auth) redirect("/login");

  const permissions = new Set(auth.user.permissions);
  const canLithotripsy = permissions.has("accounting.lithotripsy.pricing.manage");
  const canContract = permissions.has("accounting.contract.pricing.manage");
  const canEndoscopy = permissions.has("accounting.endoscopy.pricing.manage");

  if (!canLithotripsy && !canContract && !canEndoscopy) redirect("/accounts/review");

  const [lithotripsySummary, contractSummary, endoscopySummary] = await Promise.all([
    canLithotripsy
      ? Promise.all([listLithotripsySessions(), listLithotripsyProfiles()]).then(
          ([sessions, profiles]) => `${sessions.length} جلسات نشطة · ${profiles.filter((profile) => profile.active).length} قوائم أسعار نشطة`,
        )
      : null,
    canContract
      ? listServicePricing("contract", false).then((profiles) => `${profiles.length} قوائم مستشفيات نشطة`)
      : null,
    canEndoscopy
      ? listServicePricing("endoscopy", false).then((profiles) =>
          profiles.length ? `${profiles.length} قائمة أسعار عامة نشطة` : "لم تُنشأ قائمة أسعار عامة بعد",
        )
      : null,
  ]);

  const domains: PricingDomain[] = [];
  if (canLithotripsy) domains.push({
    key: "lithotripsy",
    title: "التفتيت",
    description: "إدارة أسعار جلسات التفتيت وقوائم الإجراءات والبنود المالية.",
    href: "/accounts/review/lithotripsy/pricing",
    action: "إدارة أسعار التفتيت",
    summary: lithotripsySummary ?? "",
  });
  if (canContract) domains.push({
    key: "contract",
    title: "التعاقد",
    description: "إدارة أسعار التعاقد لكل مستشفى بشكل مستقل.",
    href: "/accounts/review/contract/pricing",
    action: "إدارة أسعار التعاقد",
    summary: contractSummary ?? "",
  });
  if (canEndoscopy) domains.push({
    key: "endoscopy",
    title: "المناظير",
    description: "إدارة البنود والأسعار العامة لحالات المناظير.",
    href: "/accounts/review/endoscopy/pricing",
    action: "إدارة أسعار المناظير",
    summary: endoscopySummary ?? "",
  });

  return <main className="pricing-hub" dir="rtl">
    <header className="pricing-hub__hero">
      <nav aria-label="مسار الصفحة"><Link href="/accounts/review">الحسابات</Link><span aria-hidden="true">/</span><span>بنود وأسعار</span></nav>
      <div><span className="pricing-hub__eyebrow">مركز إدارة التسعير</span><h1>بنود وأسعار</h1><p>المكان المركزي لإدارة هياكل وأسعار التفتيت، والتعاقد، والمناظير.</p></div>
    </header>
    <section className="pricing-hub__grid" aria-label="مجالات إدارة الأسعار">
      {domains.map((domain) => <article className={`pricing-domain-card pricing-domain-card--${domain.key}`} key={domain.key}>
        <div className="pricing-domain-card__icon" aria-hidden="true"><span /></div>
        <div className="pricing-domain-card__content"><span>مجال التسعير</span><h2>{domain.title}</h2><p>{domain.description}</p><small>{domain.summary}</small></div>
        <Link href={domain.href}>{domain.action}<span aria-hidden="true">←</span></Link>
      </article>)}
    </section>
  </main>;
}
