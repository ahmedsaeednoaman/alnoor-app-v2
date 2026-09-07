import type { Metadata } from "next";

import Image from "next/image";
import { redirect } from "next/navigation";

import { AccountantHome } from "@/components/home/accountant-home";
import { EmployeeHome } from "@/components/home/employee-home";
import { OwnerHome } from "@/components/home/owner-home";
import { getCurrentSession } from "@/lib/auth/session";
import { buildHomeData, getHomeData } from "@/lib/home";

export const metadata: Metadata = {
  title: "الرئيسية",
};

export default async function HomePage() {
  const auth = await getCurrentSession();

  if (!auth) {
    redirect("/login");
  }

  if (auth.user.role.code === "employee") {
    return <EmployeeHome home={await getHomeData()} />;
  }

  if (auth.user.role.code === "accountant") {
    return <AccountantHome data={await buildHomeData(auth.user)} />;
  }

  if (auth.user.role.code === "owner") {
    return <OwnerHome home={await buildHomeData(auth.user)} />;
  }

  return (
    <section className="home-shell-preview">
      <div className="home-shell-preview__content">
        <span className="home-shell-preview__eyebrow">
          ALNOOR MEDICAL OPERATIONS
        </span>

        <h2>أهلاً، {auth.user.displayName}</h2>

        <p>كل شيء جاهز لبدء العمل.</p>

        <div className="home-shell-preview__status">
          <span aria-hidden="true" />

          <p>تم تسجيل الدخول بنجاح والجلسة فعّالة</p>
        </div>
      </div>

      <Image
        src="/images/Al-Noor Endoscope Medical Logo.png"
        alt="النور للمناظير الطبية"
        width={290}
        height={180}
        priority
        className="home-shell-preview__logo"
      />
    </section>
  );
}
