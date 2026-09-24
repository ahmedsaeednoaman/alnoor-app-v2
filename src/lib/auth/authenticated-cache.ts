import type { Cache, State } from "swr";
import type { ScopeTicket, createRequestScopeController } from "./client-request-scope";

export type ResponseContract = "smart-options-v1" | "published-template-v1";
export type CachedResponse<T> = { value: T; fetchedAt: number };
// References change more often than published schemas. These are access-time
// freshness windows, not polling intervals; confirmed mutations invalidate now.
export const REFERENCE_FRESH_MS = 60_000;
export const TEMPLATE_FRESH_MS = 300_000;
export function authenticatedKey(ticket: ScopeTicket, contract: ResponseContract, endpoint: string) {
  return JSON.stringify(["authenticated-get-v1", ticket.scope, ticket.generation, contract, endpoint]);
}
export function parseAuthenticatedKey(key: string): [string, string, number, ResponseContract, string] | null {
  try {
    const value: unknown = JSON.parse(key);
    if (Array.isArray(value) && value.length === 5 && value[0] === "authenticated-get-v1" &&
      typeof value[1] === "string" && typeof value[2] === "number" &&
      (value[3] === "smart-options-v1" || value[3] === "published-template-v1") && typeof value[4] === "string") return value as [string, string, number, ResponseContract, string];
  } catch { /* Ignore keys outside this authenticated boundary. */ }
  return null;
}
export function isFresh(data: CachedResponse<unknown> | undefined, freshness: number, now = Date.now()) {
  return Boolean(data && now - data.fetchedAt < freshness);
}

// SWR's sole completed-response store. Both reads and late writes are gated,
// including the interval before React processes a scope change.
export function createAuthenticatedCache(controller: Pick<ReturnType<typeof createRequestScopeController>, "capture" | "subscribe">) {
  const entries = new Map<string, State>();
  const allowed = (key: string) => {
    const identity = parseAuthenticatedKey(key), ticket = controller.capture();
    return Boolean(ticket && !ticket.signal.aborted && identity && identity[1] === ticket.scope && identity[2] === ticket.generation);
  };
  const cache: Cache = {
    get: key => allowed(key) ? entries.get(key) : undefined,
    set: (key, value) => { if (allowed(key)) entries.set(key, value); },
    delete: key => { entries.delete(key); },
    keys: () => entries.keys(),
  };
  return {
    cache,
    connect() {
      const clearInvalid = () => { for (const key of entries.keys()) if (!allowed(key)) entries.delete(key); };
      clearInvalid();
      const stop = controller.subscribe(clearInvalid);
      return () => { stop(); entries.clear(); };
    },
  };
}

export const authenticatedSWRSettings = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  refreshInterval: 0,
  shouldRetryOnError: false,
  dedupingInterval: 2_000,
  keepPreviousData: false,
} as const;
