"use client";

import { useSWRConfig, type Cache, type ScopedMutator } from "swr";
import { useAuthenticatedRequestScope } from "@/components/auth/request-scope-provider";
import { sourceCatalogType } from "@/components/operations/work-form-rendering";
import { REFERENCE_FRESH_MS, parseAuthenticatedKey } from "./auth/authenticated-cache";
import type { ScopeTicket } from "./auth/client-request-scope";
import { useAuthenticatedResource } from "./auth/use-authenticated-resource";
import { normalizeReferenceEndpoint, referenceRequests } from "./reference-requests";

export type ReferenceOption = { id: string; name: string };
async function loadReference(endpoint: string, ticket: ScopeTicket, isCurrent: (ticket: ScopeTicket) => boolean) {
  const request = referenceRequests.subscribe(endpoint, ticket, isCurrent, window.location.origin);
  // SWR retains this consumer while filling its cache, even across navigation.
  // Scope abort and the coordinator's 30s timeout bound abandoned requests.
  try { return await request.promise; } finally { request.release(); }
}

export async function invalidateCatalogReferences(cache: Cache, mutate: ScopedMutator, ticket: ScopeTicket,
  type: string, currentEndpoint: string, origin: string) {
  const current = normalizeReferenceEndpoint(currentEndpoint, origin);
  const sources = Object.entries(sourceCatalogType).filter(([, catalog]) => catalog === type).map(([source]) => source);
  const keys = [...cache.keys()].filter(key => {
    const identity = parseAuthenticatedKey(key);
    if (!identity || identity[1] !== ticket.scope || identity[2] !== ticket.generation || identity[3] !== "smart-options-v1") return false;
    const path = new URL(identity[4], origin).pathname;
    // These relationships are defined by sourceCatalogType and the server registry.
    // Invalidate aliases independently; never substitute their response slices.
    return identity[4] === current || path === `/api/v1/catalogs/${type}` || sources.some(source => path === `/api/v1/work-forms/references/${source}`);
  });
  await Promise.all(keys.map(key => {
    referenceRequests.supersede(parseAuthenticatedKey(key)![4], ticket, origin);
    // SWR's mutation timestamp also rejects already-settled pre-mutation GETs.
    // Clear invalid data even for unmounted keys; mounted consumers revalidate.
    return mutate(key, undefined, { revalidate: true });
  }));
}

export function useSharedReference(endpoint: string) {
  const scope = useAuthenticatedRequestScope();
  const { cache, mutate } = useSWRConfig();
  let normalized: string | null = null;
  try { normalized = normalizeReferenceEndpoint(endpoint, typeof window === "undefined" ? "http://localhost" : window.location.origin); } catch { /* Invalid endpoints remain unavailable. */ }
  const result = useAuthenticatedResource<ReferenceOption[]>(normalized, "smart-options-v1", REFERENCE_FRESH_MS, loadReference);
  return { ...result, async invalidateCatalog(type: string, ticket: ScopeTicket) {
    if (!scope.isCurrent(ticket)) return;
    await invalidateCatalogReferences(cache, mutate, ticket, type, endpoint, window.location.origin);
  } };
}
