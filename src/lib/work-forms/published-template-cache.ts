"use client";

import { useSWRConfig } from "swr";
import type { BuilderTemplate } from "@/components/operations/work-form-types";
import { useAuthenticatedRequestScope } from "@/components/auth/request-scope-provider";
import { authenticatedKey, TEMPLATE_FRESH_MS } from "@/lib/auth/authenticated-cache";
import type { ScopeTicket } from "@/lib/auth/client-request-scope";
import { useAuthenticatedResource } from "@/lib/auth/use-authenticated-resource";
import { ReferenceRequestError } from "@/lib/reference-requests";
import type { OperationType } from "./types";

async function loadPublishedTemplate(endpoint: string, ticket: ScopeTicket, isCurrent: (ticket: ScopeTicket) => boolean) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  ticket.signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 30_000);
  try {
    if (!isCurrent(ticket)) throw new DOMException("Scope changed", "AbortError");
    const response = await fetch(endpoint, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
    if (!isCurrent(ticket) || controller.signal.aborted) throw new DOMException("Scope changed", "AbortError");
    if (!response.ok) throw new ReferenceRequestError(response.status);
    const body = await response.json();
    if (!isCurrent(ticket) || controller.signal.aborted) throw new DOMException("Scope changed", "AbortError");
    const template = body?.template as BuilderTemplate | undefined;
    if (!template || typeof template.id !== "string" || !Number.isInteger(template.version) || template.version < 1 ||
      template.status !== "published" || endpoint !== `/api/v1/work-forms/${template.operationType}` || !Array.isArray(template.sections) ||
      !template.sections.every(section => Array.isArray(section.fields))) throw new Error("تعذر تحميل نموذج العمل.");
    // Only this authorized, server-sanitized GET enters SWR. Never seed it from
    // manager draft/publish responses, form values, or operation records.
    return template;
  } finally {
    clearTimeout(timeout); ticket.signal.removeEventListener("abort", abort);
  }
}

export function usePublishedTemplate(type: OperationType) {
  const scope = useAuthenticatedRequestScope();
  const { mutate } = useSWRConfig();
  const endpoint = `/api/v1/work-forms/${type}`;
  const result = useAuthenticatedResource(endpoint, "published-template-v1", TEMPLATE_FRESH_MS, loadPublishedTemplate);
  return { ...result, invalidatePublished() {
    const ticket = scope.capture();
    if (!ticket || authenticatedKey(ticket, "published-template-v1", endpoint) !== result.key) return;
    // SWR's mutation barrier rejects any GET started before confirmed publication.
    void mutate(result.key, undefined, { revalidate: true });
  } };
}
