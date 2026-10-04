export type VerifiedRequestScope = { scope: string; expiresAt: string };
export type ScopeSnapshot = { status: "checking" | "active" | "blocked"; scope: string | null; expiresAt: string | null; reason?: "access-denied" };
export type ScopeTicket = { scope: string; generation: number; signal: AbortSignal };
export type AuthTransition = { id: string; phase: "start" | "settled" };

let nextGeneration = 0;

// One controller per protected boundary. No response cache or persisted identity.
export function createRequestScopeController(
  initial: VerifiedRequestScope,
  verify: (signal: AbortSignal) => Promise<VerifiedRequestScope | null>,
  onSessionChange: (authenticated: boolean) => void,
  now: () => number = Date.now,
) {
  let snapshot: ScopeSnapshot = { status: "checking", scope: null, expiresAt: null };
  let generation = 0;
  let lifetime = new AbortController();
  let verification: AbortController | null = null;
  let verificationTimeout: ReturnType<typeof setTimeout> | null = null;
  const transitions = new Set<string>();
  const seen = new Set<string>();
  const listeners = new Set<() => void>();
  const publish = (next: ScopeSnapshot) => { snapshot = next; listeners.forEach(listener => listener()); };
  function invalidate() {
    generation = ++nextGeneration;
    lifetime.abort(); lifetime = new AbortController();
    verification?.abort(); verification = null;
    if (verificationTimeout !== null) clearTimeout(verificationTimeout);
    verificationTimeout = null;
    publish({ status: "checking", scope: null, expiresAt: null });
  }
  async function revalidate() {
    if (transitions.size) return;
    const expired = snapshot.status === "active" && Date.parse(snapshot.expiresAt!) <= now();
    if (verification && !expired) return;
    // A background identity check is not an auth transition. Keep the last
    // verified, unexpired generation usable until the server says otherwise.
    if (snapshot.status !== "active" || expired) invalidate();
    const current = generation;
    const controller = new AbortController();
    verification = controller;
    // Bound a failed/slow verification; no automatic polling or retry loop.
    const timeout = setTimeout(() => {
      controller.abort();
      if (current === generation) {
        invalidate();
        publish({ status: "blocked", scope: null, expiresAt: null });
      }
    }, 8000);
    verificationTimeout = timeout;
    try {
      const result = await verify(controller.signal);
      if (controller.signal.aborted || current !== generation) return;
      if (!result || result.scope !== initial.scope) {
        invalidate();
        publish({ status: "blocked", scope: null, expiresAt: null });
        onSessionChange(Boolean(result));
      } else if (Date.parse(result.expiresAt) <= now()) {
        invalidate();
        publish({ status: "blocked", scope: null, expiresAt: null });
        onSessionChange(false);
      } else {
        publish({ status: "active", ...result });
      }
    } catch {
      if (!controller.signal.aborted && current === generation) {
        invalidate();
        publish({ status: "blocked", scope: null, expiresAt: null });
      }
    } finally {
      clearTimeout(timeout);
      if (verification === controller) { verification = null; verificationTimeout = null; }
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    invalidate,
    deny() {
      invalidate();
      publish({ status: "blocked", scope: null, expiresAt: null, reason: "access-denied" });
    },
    revalidate,
    transition(event: AuthTransition) {
      const key = `${event.id}:${event.phase}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (seen.size > 128) seen.delete(seen.values().next().value!);
      if (event.phase === "start") {
        // A delayed duplicate start after its settled signal must not relock us.
        if (seen.has(`${event.id}:settled`)) return;
        transitions.add(event.id);
      } else transitions.delete(event.id);
      invalidate();
      if (!transitions.size) void revalidate();
    },
    capture(): ScopeTicket | null {
      if (snapshot.status !== "active" || !snapshot.scope || Date.parse(snapshot.expiresAt!) <= now()) return null;
      return { scope: snapshot.scope, generation, signal: lifetime.signal };
    },
    isCurrent(ticket: ScopeTicket) {
      return snapshot.status === "active" && snapshot.scope === ticket.scope && generation === ticket.generation &&
        ticket.signal === lifetime.signal && !ticket.signal.aborted && Date.parse(snapshot.expiresAt!) > now();
    },
    dispose() { invalidate(); listeners.clear(); },
  };
}

const CHANNEL = "alnoor-auth-transition-v1";
const STORAGE_KEY = "alnoor-auth-transition-signal";
const LOCAL_EVENT = "alnoor-auth-transition";

// Focus/visibility/pageshow often arrive together. Coalesce that event burst,
// without treating blur, backgrounding or BFCache entry as logout.
export function listenForScopeLifecycle(revalidate: () => Promise<void>) {
  let frame: number | null = null;
  const visible = () => {
    if (document.visibilityState !== "visible" || frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      if (document.visibilityState === "visible") void revalidate();
    });
  };
  for (const event of ["focus", "online", "pageshow"]) window.addEventListener(event, visible);
  document.addEventListener("visibilitychange", visible);
  visible();
  return () => {
    if (frame !== null) window.cancelAnimationFrame(frame);
    for (const event of ["focus", "online", "pageshow"]) window.removeEventListener(event, visible);
    document.removeEventListener("visibilitychange", visible);
  };
}
function isTransition(value: unknown): value is AuthTransition {
  return typeof value === "object" && value !== null && "id" in value && typeof value.id === "string" &&
    value.id.length <= 80 && "phase" in value && (value.phase === "start" || value.phase === "settled");
}
function emitTransition(event: AuthTransition) {
  window.dispatchEvent(new CustomEvent(LOCAL_EVENT, { detail: event }));
  let channel: BroadcastChannel | undefined;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(event);
  } catch { /* Storage also supports browsers without BroadcastChannel. */ }
  finally { channel?.close(); }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(event)); } catch { /* Focus/visibility revalidation remains available. */ }
}

// Signal before the POST, and again once its response is settled (including failures).
// Messages contain no identity, request scope, credential or response data.
export function beginAuthTransition() {
  // This is only a deduplication nonce, never an identity or credential.
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  emitTransition({ id, phase: "start" });
  let settled = false;
  return () => { if (!settled) { settled = true; emitTransition({ id, phase: "settled" }); } };
}
export function listenForAuthTransitions(receive: (event: AuthTransition) => void) {
  const accept = (value: unknown) => { if (isTransition(value)) receive(value); };
  const local = (event: Event) => { if (event instanceof CustomEvent) accept(event.detail); };
  const storage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try { accept(JSON.parse(event.newValue)); } catch { /* Ignore malformed signals. */ }
  };
  let channel: BroadcastChannel | undefined;
  try { channel = new BroadcastChannel(CHANNEL); channel.onmessage = event => accept(event.data); } catch { /* Storage fallback. */ }
  window.addEventListener(LOCAL_EVENT, local);
  window.addEventListener("storage", storage);
  return () => { channel?.close(); window.removeEventListener(LOCAL_EVENT, local); window.removeEventListener("storage", storage); };
}
