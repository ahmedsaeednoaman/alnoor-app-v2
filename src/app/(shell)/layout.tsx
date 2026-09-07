import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { getCurrentSession } from "@/lib/auth/session";

export default async function ProtectedShellLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const auth = await getCurrentSession();

  if (!auth) {
    redirect("/login");
  }

  return (
    <AppShell
      user={{
        displayName: auth.user.displayName,
        username: auth.user.username,
        allowedModules: auth.user.allowedModules,
        permissions: auth.user.permissions,
      }}
    >
      {children}
    </AppShell>
  );
}
