"use client";

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { createRequestScopeController, listenForAuthTransitions, listenForScopeLifecycle, type VerifiedRequestScope } from "@/lib/auth/client-request-scope";

import { AppLoading } from "@/components/shell/app-loading";
import { SWRConfig } from "swr";
import { authenticatedSWRSettings, createAuthenticatedCache } from "@/lib/auth/authenticated-cache";

type ScopeController = ReturnType<typeof createRequestScopeController>;
const RequestScopeContext = createContext<ScopeController | null>(null);

async function verifyScope(signal: AbortSignal): Promise<VerifiedRequestScope | null> {
  const response = await fetch("/api/v1/auth/request-scope", { cache: "no-store", credentials: "same-origin", signal });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Scope verification failed");
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("scope" in body) || typeof body.scope !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(body.scope) || !("expiresAt" in body) || typeof body.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(body.expiresAt))) throw new Error("Invalid scope response");
  return { scope: body.scope, expiresAt: body.expiresAt };
}

export function RequestScopeProvider({ initial, children }: { initial: VerifiedRequestScope; children: ReactNode }) {
  const [controller] = useState(() => createRequestScopeController(initial, verifyScope, authenticated => {
    // Rebuild all server-provided permissions and component state for a new scope.
    if (authenticated) window.location.reload();
    else window.location.replace("/login");
  }));
  const [store] = useState(() => createAuthenticatedCache(controller));
  const swr = useMemo(() => ({ ...authenticatedSWRSettings, provider: () => store.cache }), [store]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => store.connect(), [store]);
  useEffect(() => {
    const stop = listenForAuthTransitions(controller.transition);
    const stopLifecycle = listenForScopeLifecycle(controller.revalidate);
    return () => {
      stopLifecycle(); stop(); controller.dispose();
    };
  }, [controller]);
  useEffect(() => {
    if (snapshot.status !== "active" || !snapshot.expiresAt) return;
    const timer = window.setTimeout(() => { void controller.revalidate(); },
      Math.min(2_147_483_647, Math.max(0, Date.parse(snapshot.expiresAt) - Date.now())));
    return () => window.clearTimeout(timer);
  }, [controller, snapshot]);
  const active = snapshot.status === "active";
  return <RequestScopeContext.Provider value={controller}>
    {/* Keep same-session form state, but hide it during unresolved authentication. */}
    <div hidden={!active} inert={!active}><SWRConfig value={swr}>{children}</SWRConfig></div>
    {!active && <AppLoading
      fullScreen
      busy={snapshot.status !== "blocked"}
      message={snapshot.reason === "access-denied" ? "انتهت الجلسة أو لم تعد لديك صلاحية الوصول. أعد التحقق للمتابعة." : snapshot.status === "blocked" ? "تعذر التحقق من الجلسة. أعد المحاولة عند توفر الاتصال." : "جارٍ التحقق من الجلسة…"}
      actions={snapshot.status === "blocked" ? <>
        <button type="button" onClick={() => { void controller.revalidate(); }}>إعادة التحقق</button>
        <button type="button" onClick={() => window.location.reload()}>إعادة تحميل الصفحة</button>
      </> : undefined}
    />}
  </RequestScopeContext.Provider>;
}

// Capture a ticket before starting work; check isCurrent(ticket) immediately
// before applying its result. signal cancels work when the scope is invalidated.
// Future shared registries must include ticket.scope AND ticket.generation.
// On a detected auth error, invalidate() before revalidate() to supersede any check.
export function useAuthenticatedRequestScope() {
  const controller = useContext(RequestScopeContext);
  if (!controller) throw new Error("Request scope requires the protected shell");
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return { ...snapshot, capture: controller.capture, isCurrent: controller.isCurrent, invalidate: controller.invalidate, deny: controller.deny, revalidate: controller.revalidate };
}
