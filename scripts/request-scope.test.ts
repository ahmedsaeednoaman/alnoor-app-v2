import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { authenticatedRequestScope } from "../src/lib/auth/request-scope";
import { beginAuthTransition, createRequestScopeController, listenForAuthTransitions, type AuthTransition, type VerifiedRequestScope } from "../src/lib/auth/client-request-scope";

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const first: VerifiedRequestScope = { scope: "session-a", expiresAt: "2030-01-02T00:00:00Z" };
function fixture() {
  let now = Date.parse("2030-01-01T00:00:00Z");
  const requests: Array<{ signal: AbortSignal; resolve: (scope: VerifiedRequestScope | null) => void; reject: (error: Error) => void }> = [];
  const navigations: boolean[] = [];
  const controller = createRequestScopeController(first, signal => new Promise((resolve, reject) => requests.push({ signal, resolve, reject })), value => navigations.push(value), () => now);
  return { controller, requests, navigations, expire: () => { now = Date.parse(first.expiresAt) + 1; } };
}
async function activate(f: ReturnType<typeof fixture>) {
  const pending = f.controller.revalidate(); f.requests.at(-1)!.resolve(first); await pending;
  assert.equal(f.controller.getSnapshot().status, "active");
}
async function main() {
  // Synthetic test credentials only; never load environment files or real sessions.
  const originalSecret = process.env.SESSION_SECRET;
  try {
    process.env.SESSION_SECRET = "request-scope-test-secret-not-a-real-credential";
    const auth = { session: { id: "session-uuid-one", expiresAt: new Date(first.expiresAt) }, user: {
      id: "user-one", username: "test", displayName: "Test", role: { id: "role", code: "employee", name: "Employee" },
      permissions: ["operations.view", "operations.create"], allowedModules: ["operations"],
    } };
    const scope = authenticatedRequestScope(auth);
    assert.match(scope.scope, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(scope.expiresAt, new Date(first.expiresAt).toISOString());
    assert.equal(scope.scope.includes(auth.session.id), false);
    assert.equal(authenticatedRequestScope(auth).scope, scope.scope);
    assert.equal(authenticatedRequestScope({ ...auth, user: { ...auth.user, permissions: [...auth.user.permissions].reverse() } }).scope, scope.scope);
    assert.notEqual(authenticatedRequestScope({ ...auth, session: { ...auth.session, id: "new-session-same-user" } }).scope, scope.scope);
    assert.notEqual(authenticatedRequestScope({ ...auth, user: { ...auth.user, id: "other-user" } }).scope, scope.scope);
    assert.notEqual(authenticatedRequestScope({ ...auth, user: { ...auth.user, permissions: ["operations.view"] } }).scope, scope.scope);
  } finally {
    if (originalSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = originalSecret;
  }

  const f = fixture(); assert.equal(f.controller.capture(), null); await activate(f);
  const old = f.controller.capture()!;
  assert.equal(f.controller.isCurrent(old), true);
  f.controller.transition({ id: "logout", phase: "start" });
  assert.equal(old.signal.aborted, true); assert.equal(f.controller.isCurrent(old), false); assert.equal(f.controller.capture(), null);
  await f.controller.revalidate(); assert.equal(f.requests.length, 1, "do not verify mid-transition");
  f.controller.transition({ id: "logout", phase: "settled" });
  f.requests[1].resolve(null); await flush(); assert.deepEqual(f.navigations, [false]);
  assert.equal(f.controller.capture(), null); f.controller.dispose();

  for (const scope of ["different-user", "same-user-new-session", "changed-permissions"]) {
    const next = fixture(); await activate(next); const ticket = next.controller.capture()!;
    next.controller.transition({ id: "login", phase: "start" });
    next.controller.transition({ id: "login", phase: "settled" });
    next.requests[1].resolve({ ...first, scope }); await flush();
    assert.equal(next.controller.isCurrent(ticket), false); assert.equal(next.controller.capture(), null);
    assert.deepEqual(next.navigations, [true], "new identity requires rebuilding protected shell"); next.controller.dispose();
  }
  const race = fixture(); await activate(race);
  const oldTicket = race.controller.capture()!;
  void race.controller.revalidate();
  race.controller.transition({ id: "one", phase: "start" });
  race.controller.transition({ id: "two", phase: "start" });
  race.controller.transition({ id: "one", phase: "settled" }); assert.equal(race.requests.length, 2);
  race.controller.transition({ id: "two", phase: "settled" }); assert.equal(race.requests.length, 3);
  race.requests[1].resolve(first); await flush(); assert.equal(race.controller.capture(), null);
  race.requests[2].resolve(first); await flush(); assert.ok(race.controller.capture());
  assert.equal(race.controller.isCurrent(oldTicket), false, "same scope string must not revive old generation");
  race.controller.transition({ id: "two", phase: "start" }); assert.equal(race.requests.length, 3, "late/duplicate delivery ignored");
  race.controller.dispose();

  const focus = fixture(); await activate(focus); const beforeExpiry = focus.controller.capture()!;
  const backgroundCheck = focus.controller.revalidate();
  assert.ok(focus.controller.isCurrent(beforeExpiry), "unexpired identity stays active during background verification");
  focus.expire(); assert.equal(focus.controller.capture(), null); assert.equal(focus.controller.isCurrent(beforeExpiry), false);
  const check = focus.controller.revalidate();
  assert.equal(focus.requests[1].signal.aborted, true, "expiry supersedes background verification");
  assert.equal(focus.controller.getSnapshot().status, "checking");
  focus.requests[1].resolve(first); await backgroundCheck;
  focus.requests[2].resolve(null); await check; assert.deepEqual(focus.navigations, [false]); focus.controller.dispose();
  const offline = fixture(); await activate(offline); const pending = offline.controller.revalidate();
  offline.requests[1].reject(new Error("offline")); await pending; assert.equal(offline.controller.getSnapshot().status, "blocked");
  assert.equal(offline.controller.capture(), null); await activate(offline); offline.controller.dispose();
  const coalesce = fixture(); const checkOne = coalesce.controller.revalidate(); void coalesce.controller.revalidate();
  assert.equal(coalesce.requests.length, 1); coalesce.requests[0].resolve(first); await checkOne;
  const other = fixture(); await activate(other); assert.equal(other.controller.isCurrent(coalesce.controller.capture()!), false);
  other.controller.dispose(); coalesce.controller.dispose();

  // Exercise actual broadcast/local/storage transport with browser boundaries mocked.
  const properties = ["window", "localStorage", "BroadcastChannel"] as const;
  const originals = new Map(properties.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const target = new EventTarget();
  const stored: string[] = [];
  class FakeChannel {
    static instances = new Set<FakeChannel>();
    onmessage: ((event: { data: unknown }) => void) | null = null;
    constructor() { FakeChannel.instances.add(this); }
    postMessage(data: unknown) { for (const instance of FakeChannel.instances) if (instance !== this) instance.onmessage?.({ data }); }
    close() { FakeChannel.instances.delete(this); }
  }
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: target });
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { setItem: (_: string, value: string) => stored.push(value) } });
    Object.defineProperty(globalThis, "BroadcastChannel", { configurable: true, value: FakeChannel });
    const a = fixture(), b = fixture(); await activate(a); await activate(b);
    const stopA = listenForAuthTransitions(a.controller.transition), stopB = listenForAuthTransitions(b.controller.transition);
    const ticketA = a.controller.capture()!, ticketB = b.controller.capture()!;
    const settled = beginAuthTransition();
    assert.equal(a.controller.isCurrent(ticketA), false); assert.equal(b.controller.isCurrent(ticketB), false);
    settled(); settled(); assert.equal(a.requests.length, 2); assert.equal(b.requests.length, 2);
    a.requests[1].resolve(first); b.requests[1].resolve(first); await flush();
    assert.deepEqual(Object.keys(JSON.parse(stored[0])).sort(), ["id", "phase"]);
    stopA(); stopB(); a.controller.dispose(); b.controller.dispose(); assert.equal(FakeChannel.instances.size, 0);

    Object.defineProperty(globalThis, "BroadcastChannel", { configurable: true, value: class { constructor() { throw new Error("unsupported"); } } });
    const fallback = fixture(); await activate(fallback); const stop = listenForAuthTransitions(fallback.controller.transition);
    const sendStorage = (value: AuthTransition) => { const event = new Event("storage"); Object.assign(event, { key: "alnoor-auth-transition-signal", newValue: JSON.stringify(value) }); target.dispatchEvent(event); };
    sendStorage({ id: "other-tab", phase: "start" }); assert.equal(fallback.controller.capture(), null);
    sendStorage({ id: "other-tab", phase: "settled" }); fallback.requests[1].resolve(null); await flush();
    assert.deepEqual(fallback.navigations, [false]); stop(); fallback.controller.dispose();
  } finally {
    for (const key of properties) { const descriptor = originals.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
  // Verification timeout and cleanup use a deterministic clock, not an 8s sleep.
  const oldSetTimeout = Object.getOwnPropertyDescriptor(globalThis, "setTimeout")!;
  const oldClearTimeout = Object.getOwnPropertyDescriptor(globalThis, "clearTimeout")!;
  const timers = new Map<number, () => void>(); let timerId = 0;
  try {
    Object.defineProperty(globalThis, "setTimeout", { configurable: true, value: (callback: () => void) => { timers.set(++timerId, callback); return timerId; } });
    Object.defineProperty(globalThis, "clearTimeout", { configurable: true, value: (id: number) => timers.delete(id) });
    const slow = fixture(); const waiting = slow.controller.revalidate();
    const [id, timeout] = [...timers][0]; timers.delete(id); timeout();
    assert.equal(slow.controller.getSnapshot().status, "blocked"); assert.equal(slow.requests[0].signal.aborted, true);
    slow.requests[0].resolve(first); await waiting; assert.equal(slow.controller.capture(), null);
    void slow.controller.revalidate(); assert.equal(timers.size, 1); slow.controller.dispose(); assert.equal(timers.size, 0);
    slow.requests[1].resolve(first); await flush(); assert.equal(slow.controller.capture(), null);
  } finally {
    Object.defineProperty(globalThis, "setTimeout", oldSetTimeout); Object.defineProperty(globalThis, "clearTimeout", oldClearTimeout);
  }

  // Execute the real GET route with a mocked session validator; no DB or credentials.
  let authenticated = true, fail = false, checks = 0;
  const routeExports: { GET?: () => Promise<Response> } = {};
  const compiledRoute = ts.transpileModule(readFileSync("src/app/api/v1/auth/request-scope/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiledRoute, { exports: routeExports, require: (name: string) => {
    if (name === "next/server") return { NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) } };
    if (name.endsWith("/session")) return { getCurrentSession: async () => { checks++; if (fail) throw new Error("private auth internals"); return authenticated ? {} : null; } };
    if (name.endsWith("/request-scope")) return { authenticatedRequestScope: () => first };
    throw new Error(`Unexpected import: ${name}`);
  } });
  assert.ok(routeExports.GET);
  const valid = await routeExports.GET(); assert.equal(valid.status, 200); assert.deepEqual(await valid.json(), first);
  assert.match(valid.headers.get("Cache-Control")!, /private, no-store/); assert.equal(valid.headers.get("Vary"), "Cookie");
  authenticated = false; const unauthorized = await routeExports.GET(); assert.equal(unauthorized.status, 401); assert.deepEqual(await unauthorized.json(), { scope: null });
  fail = true; const failed = await routeExports.GET(); assert.equal(failed.status, 503); assert.equal((await failed.text()).includes("private auth internals"), false); assert.equal(checks, 3);

  const provider = readFileSync("src/components/auth/request-scope-provider.tsx", "utf8");
  assert.match(provider, /listenForScopeLifecycle\(controller.revalidate\)/);
  assert.match(provider, /hidden=\{!active\} inert=\{!active\}/);
  const route = readFileSync("src/app/api/v1/auth/request-scope/route.ts", "utf8");
  assert.match(route, /await getCurrentSession\(\)/); assert.match(route, /private, no-store/); assert.match(route, /status: 401/);
  for (const file of ["src/components/auth/login-form.tsx", "src/components/shell/app-sidebar.tsx"]) assert.match(readFileSync(file, "utf8"), /finally\(settleTransition\)/);
  console.log("Request scope: PASS (opaque session/permission identity, tickets, race rejection, expiry, failure, broadcast and storage fallback; mocked browser/server boundaries)");
}
void main();
