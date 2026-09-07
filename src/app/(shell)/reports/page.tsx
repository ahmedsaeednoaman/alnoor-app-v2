import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentSession } from "@/lib/auth/session";
export default async function Page() { const auth = await getCurrentSession(); if (!auth) redirect("/login"); if (!auth.user.permissions.includes("reports.view")) redirect("/"); return <section className="print-center page-surface"><h1>التقارير</h1><p>التقارير التشغيلية والمالية المعتمدة.</p><Link className="button-primary" href="/reports/contracts/monthly">تقرير التعاقد الشهري</Link></section>; }
