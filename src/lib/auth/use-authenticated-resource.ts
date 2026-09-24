"use client";

import useSWR, { useSWRConfig } from "swr";
import { useAuthenticatedRequestScope } from "@/components/auth/request-scope-provider";
import { ReferenceRequestError } from "@/lib/reference-requests";
import { authenticatedKey, isFresh, type CachedResponse, type ResponseContract } from "./authenticated-cache";
import type { ScopeTicket } from "./client-request-scope";

export function useAuthenticatedResource<T>(endpoint: string | null, contract: ResponseContract, freshness: number,
  load: (endpoint: string, ticket: ScopeTicket, isCurrent: (ticket: ScopeTicket) => boolean) => Promise<T>) {
  const scope = useAuthenticatedRequestScope();
  const { cache } = useSWRConfig();
  const { capture } = scope;
  const ticket = scope.capture();
  const key = ticket && endpoint ? authenticatedKey(ticket, contract, endpoint) : null;
  const cached = key ? cache.get(key)?.data as CachedResponse<T> | undefined : undefined;
  const resource = useSWR<CachedResponse<T>, Error>(key, async () => {
    const current = scope.capture();
    if (!current || !endpoint || authenticatedKey(current, contract, endpoint) !== key) throw new DOMException("Scope changed", "AbortError");
    try {
      const value = await load(endpoint, current, scope.isCurrent);
      if (!scope.isCurrent(current)) throw new DOMException("Scope changed", "AbortError");
      return { value, fetchedAt: Date.now() };
    } catch (error) {
      if (scope.isCurrent(current) && error instanceof ReferenceRequestError && [401, 403].includes(error.status)) {
        // Lock the protected boundary. Only explicit scope verification may retry;
        // endpoint-specific denials must never form a verification/fetch loop.
        scope.deny();
      }
      throw error;
    }
  }, { revalidateOnMount: !isFresh(cached, freshness), revalidateIfStale: false });
  const { mutate } = resource;
  function refreshIfStale() {
    if (!key || !capture()) return;
    if (!isFresh(cache.get(key)?.data as CachedResponse<T> | undefined, freshness)) void mutate().catch(() => {});
  }
  // Gate SWR's hook-local snapshot as well as its backing cache.
  const usable = Boolean(ticket && scope.isCurrent(ticket) && key);
  const data = usable ? resource.data : undefined;
  return { key, data: data?.value, error: usable ? resource.error : undefined, refreshIfStale,
    state: scope.reason === "access-denied" ? "permission-denied" : !usable ? "unresolved" : resource.error ? "network-failure" : resource.isValidating ? (data ? "revalidating" : "loading") : data ? "cached" : "invalidated",
  };
}
