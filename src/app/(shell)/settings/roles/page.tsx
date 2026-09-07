import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RolesPermissions } from "@/components/settings/roles/roles-permissions";
import { getCurrentSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "الأدوار والصلاحيات",
};

export default async function RolesPage() {
  const auth = await getCurrentSession();

  if (!auth) {
    redirect("/login");
  }

  if (!auth.user.permissions.includes("settings.view")) {
    redirect("/");
  }

  const canManage =
    auth.user.role.code === "owner" &&
    auth.user.permissions.includes("settings.manage");

  return <RolesPermissions canManage={canManage} />;
}
