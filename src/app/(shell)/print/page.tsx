import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentSession } from "@/lib/auth/session";
export default async function Page() { const auth = await getCurrentSession(); if (!auth) redirect("/login"); if (!auth.user.permissions.includes("printing.use")) redirect("/"); return <section className="print-center page-surface"><h1>مركز الطباعة</h1><p>اختر عملية من التفاصيل لاستخدام الطباعة التاريخية.</p><Link className="button-primary" href="/operations">عرض العمليات</Link></section>; }
