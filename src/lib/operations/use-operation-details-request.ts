"use client";
import { useCallback } from "react";
import { useAuthenticatedRequestScope } from "@/components/auth/request-scope-provider";
import { OperationDetailRequestError, readOperationDetails } from "./detail-requests";

export function useOperationDetailsRequest<T>(id: string) {
  const { status, capture, isCurrent, deny } = useAuthenticatedRequestScope();
  const read = useCallback(async (force = false): Promise<T> => {
    const ticket = capture();
    if (!ticket) throw new DOMException("Authentication unresolved", "AbortError");
    try {
      const result = await readOperationDetails(id, ticket, isCurrent, force);
      if (!isCurrent(ticket)) throw new DOMException("Authentication changed", "AbortError");
      return result as T;
    }
    catch (error) {
      if (isCurrent(ticket) && error instanceof OperationDetailRequestError && [401, 403].includes(error.status)) deny();
      throw error;
    }
  }, [id, capture, isCurrent, deny]);
  return { read, ready: status === "active" };
}
