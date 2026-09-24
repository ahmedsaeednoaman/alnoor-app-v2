import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { RequestScopeProvider } from "@/components/auth/request-scope-provider";
import { authenticatedRequestScope } from "@/lib/auth/request-scope";
import { getCurrentSession } from "@/lib/auth/session";

export default async function ProtectedShellLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const auth = await getCurrentSession();

  if (!auth) {
    redirect("/login");
  }

  const requestScope = authenticatedRequestScope(auth);
  return (
    <RequestScopeProvider key={requestScope.scope} initial={requestScope}>
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
    </RequestScopeProvider>
  );
}
