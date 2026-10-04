import type { ScopeTicket } from "@/lib/auth/client-request-scope";

const aborted = () => new DOMException("Operation request superseded", "AbortError");
export class OperationDetailRequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// Pending requests only: no completed medical/financial DTO cache. Strict Mode
// effect replay and concurrent consumers share a GET within the same lifetime.
export function createOperationDetailRequests(fetcher: typeof fetch = (...args) => fetch(...args)) {
  const lifetimes = new WeakMap<AbortSignal, Map<string, { promise: Promise<unknown>; cancel: () => void }>>();
  return function read(id: string, ticket: ScopeTicket, isCurrent: (ticket: ScopeTicket) => boolean, force = false): Promise<unknown> {
    if (!isCurrent(ticket)) return Promise.reject(aborted());
    let pending = lifetimes.get(ticket.signal);
    if (!pending) { pending = new Map(); lifetimes.set(ticket.signal, pending); }
    const key = JSON.stringify([ticket.scope, ticket.generation, id]);
    const existing = pending.get(key);
    if (existing && !force) return existing.promise;
    existing?.cancel();
    const controller = new AbortController();
    let rejectCancellation: (reason: Error) => void;
    const cancellation = new Promise<never>((_, reject) => { rejectCancellation = reject; });
    const cancel = () => { controller.abort(); rejectCancellation(aborted()); };
    ticket.signal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, 30_000);
    const request = Promise.resolve().then(async () => {
      if (controller.signal.aborted || !isCurrent(ticket)) throw aborted();
      const response = await fetcher(`/api/v1/operations/${encodeURIComponent(id)}`, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
      const body = await response.json();
      if (controller.signal.aborted || !isCurrent(ticket)) throw aborted();
      if (!response.ok) throw new OperationDetailRequestError(response.status, body.error?.message ?? "تعذر تحميل تفاصيل العملية.");
      return body;
    });
    const entry = { promise: Promise.race([request, cancellation]).finally(() => {
      clearTimeout(timer);
      ticket.signal.removeEventListener("abort", cancel);
      if (pending.get(key) === entry) pending.delete(key);
    }), cancel };
    pending.set(key, entry);
    return entry.promise;
  };
}

export const readOperationDetails = createOperationDetailRequests();
