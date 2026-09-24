import type { ScopeTicket } from "./auth/client-request-scope";

export class ReferenceRequestError extends Error {
  constructor(public status: number) { super(`Reference request failed (${status})`); }
}

export function normalizeReferenceEndpoint(endpoint: string, origin: string) {
  const url = new URL(endpoint, origin);
  if (url.origin !== new URL(origin).origin || url.username || url.password) throw new Error("References must be same-origin without credentials");
  return url.pathname + url.search;
}

type Option = { id: string; name: string };
type Consumer = {
  resolve: (options: Option[]) => void;
  reject: (error: unknown) => void;
  current: () => boolean;
};
type Entry = { consumers: Set<Consumer>; cancel: () => void; signal: AbortSignal };
const cancelled = () => new DOMException("Reference request is no longer current", "AbortError");

// Only pending SmartSelect GETs, with one fixed response contract and request policy.
// Completed payloads are never cached. Query order/values are deliberately preserved.
export function createReferenceRequests(fetcher: typeof fetch = (...args) => fetch(...args)) {
  const pending = new Map<string, Entry>();
  function subscribe(endpoint: string, ticket: ScopeTicket, isCurrent: (ticket: ScopeTicket) => boolean, origin: string) {
    const url = new URL(normalizeReferenceEndpoint(endpoint, origin), origin);
    if (!isCurrent(ticket) || ticket.signal.aborted) throw cancelled();
    const key = JSON.stringify([ticket.scope, ticket.generation, "smart-options-v1", "GET", url.href]);
    let entry = pending.get(key);
    // Signal identity also isolates independent provider lifetimes.
    if (entry && entry.signal !== ticket.signal) { entry.cancel(); entry = undefined; }
    if (!entry) {
      const controller = new AbortController();
      const consumers = new Set<Consumer>();
      let settled = false;
      const finish = (error: unknown, options?: Option[]) => {
        if (settled) return;
        settled = true;
        if (pending.get(key) === created) pending.delete(key);
        clearTimeout(timeout);
        ticket.signal.removeEventListener("abort", cancel);
        for (const consumer of consumers) {
          if (error) consumer.reject(error);
          else if (!consumer.current()) consumer.reject(cancelled());
          else consumer.resolve(options ?? []);
        }
        consumers.clear();
      };
      const cancel = () => { finish(cancelled()); controller.abort(); };
      const created: Entry = { consumers, cancel, signal: ticket.signal };
      // Bound stalled fetch/body reads, even if a transport ignores abort.
      const timeout = setTimeout(() => { finish(new Error("Reference request timed out")); controller.abort(); }, 30_000);
      pending.set(key, created);
      ticket.signal.addEventListener("abort", cancel, { once: true });
      entry = created;
      void Promise.resolve().then(async () => {
        if (settled) return;
        const response = await fetcher(url.href, { signal: controller.signal, credentials: "same-origin", cache: "no-store" });
        if (!response.ok) throw new ReferenceRequestError(response.status);
        const body: unknown = await response.json();
        if (!body || typeof body !== "object") throw new Error("Invalid reference response");
        const items = "items" in body ? body.items : undefined;
        if (!Array.isArray(items) || !items.every((item: unknown) => item !== null && typeof item === "object" &&
          "id" in item && typeof item.id === "string" && "name" in item && typeof item.name === "string")) {
          throw new Error("Invalid reference options");
        }
        finish(null, items.map(item => ({ id: item.id, name: item.name })));
      }).catch(error => finish(error));
    }
    const shared = entry;
    let consumer: Consumer;
    const promise = new Promise<Option[]>((resolve, reject) => {
      consumer = { resolve, reject, current: () => isCurrent(ticket) };
      shared.consumers.add(consumer);
    });
    // Cancellation may precede a caller attaching its handler.
    void promise.catch(() => {});
    return {
      promise,
      release() {
        if (!shared.consumers.delete(consumer)) return;
        consumer.reject(cancelled());
        if (!shared.consumers.size) shared.cancel();
      },
    };
  }
  function supersede(endpoint: string, ticket: ScopeTicket, origin: string) {
    const url = new URL(normalizeReferenceEndpoint(endpoint, origin), origin);
    const key = JSON.stringify([ticket.scope, ticket.generation, "smart-options-v1", "GET", url.href]);
    pending.get(key)?.cancel();
  }
  return { subscribe, supersede };
}

export const referenceRequests = createReferenceRequests();
