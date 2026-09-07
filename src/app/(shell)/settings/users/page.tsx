import type { Metadata } from "next";

import { redirect } from "next/navigation";

import { UsersList } from "@/components/settings/users/users-list";

import { getCurrentSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "إدارة المستخدمين",
};

export default async function UsersPage() {
  const auth = await getCurrentSession();

  if (!auth) {
    redirect("/login");
  }

  /*
   * الحماية هنا Server-side.
   *
   * إخفاء العنصر من Sidebar
   * وحده لا يكفي.
   */
  if (!auth.user.permissions.includes("users.view")) {
    redirect("/");
  }

  const canManage = auth.user.permissions.includes("users.manage");

  return (
    <UsersList
      canManage={canManage}
      canCreateOwner={auth.user.role.code === "owner"}
    />
  );
}
