import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as nodeModule from "node:module";
// Runtime is Node 24; the project's @types/node remains 20.
type HookResult = { url?: string; format?: string; source?: string; shortCircuit?: boolean };
type Hook = (value: string, context: object, next: (value: string, context: object) => HookResult) => HookResult;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: Hook; load: Hook }) => unknown };
import vm from "node:vm";
import { subscriptionSchema, unsubscribeSchema, isPushEligible, providerFailure, testPayload } from "../src/lib/push/validation";
import { applicationServerKey } from "../src/lib/push/client";

const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const actor = { user: { id: userId, role: { code: "owner" }, permissions: ["operations.view"] }, session: { id: sessionId } };
const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/test", keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"), auth: Buffer.alloc(16, 2).toString("base64url") } };
assert.equal(isPushEligible({ ...actor.user, role: { code: "employee" } }), false);
for (const code of ["owner", "accountant"]) assert.equal(isPushEligible({ ...actor.user, role: { code } }), true);
assert.equal(isPushEligible({ ...actor.user, permissions: [] }), false);
assert.deepEqual(subscriptionSchema.parse(subscription), subscription);
for (const field of ["user_id", "session_id", "role", "userId", "sessionId"]) assert.equal(subscriptionSchema.safeParse({ ...subscription, [field]: "forged" }).success, false);
for (const value of [null, {}, { ...subscription, keys: {} }, { ...subscription, endpoint: "http://fcm.googleapis.com/test" }, { ...subscription, endpoint: "https://evil.example/test" }, { ...subscription, endpoint: "https://fcm.googleapis.com.evil.example/test" }, { ...subscription, endpoint: "https://user:pass@fcm.googleapis.com/test" }, { ...subscription, keys: { ...subscription.keys, auth: "a" } }]) assert.equal(subscriptionSchema.safeParse(value).success, false);
assert.equal(unsubscribeSchema.safeParse({ endpoint: subscription.endpoint, user_id: "forged" }).success, false);
assert.deepEqual([...applicationServerKey("-_8")], [251, 255]);
assert.deepEqual([...applicationServerKey("AQIDBA==")], [1, 2, 3, 4]);
for (const statusCode of [404, 410]) assert.equal(providerFailure({ statusCode }), "expired");
for (const statusCode of [429, 500, 503]) assert.equal(providerFailure({ statusCode }), "temporary");
assert.equal(providerFailure(new Error("timeout")), "temporary");
assert.deepEqual(testPayload, { type: "push-test", url: "/operations" });

// Exercise the real SW in an isolated worker-like context, without registering it.
const sw = readFileSync("public/sw.js", "utf8");
const legacy = sw.slice(0, sw.indexOf("\n// Push adds"));
assert.equal(createHash("sha256").update(legacy).digest("hex"), "da7e9939bc90515c892a7da60c55bb8873cd9f59152e71731820016e9c693d95", "original install/activate/fetch/cache implementation unchanged");
const handlers: Record<string, (event: unknown) => void> = {};
const shown: Array<{ title: string; options: { body: string; data: { url: string } } }> = [];
let opened = "", navigated = "", focused = false;
const context = vm.createContext({ URL, self: { location: { origin: "https://alnoor.example" }, addEventListener: (name: string, handler: (event: unknown) => void) => { handlers[name] = handler; }, registration: { showNotification: async (title: string, options: typeof shown[number]["options"]) => { shown.push({ title, options }); } }, clients: { matchAll: async () => [], openWindow: async (path: string) => { opened = path; } } } });
vm.runInContext(sw, context);
for (const name of ["install", "activate", "fetch", "push", "notificationclick"]) assert.equal(typeof handlers[name], "function");
for (const url of ["/operations", "https://evil.example", "//evil.example", "javascript:alert(1)", "data:text/html,x", "/\\evil.example", "/operations?redirect=https://evil.example", "/api/v1/auth/logout"]) {
  const path = vm.runInContext(`safePushPath(${JSON.stringify(url)})`, context);
  assert.equal(path, "/operations");
}
async function workerEvent(name: string, extra: object) {
  let work: Promise<unknown> | undefined;
  handlers[name]({ ...extra, waitUntil: (promise: Promise<unknown>) => { work = promise; } });
  await work;
}

async function main() {
  await workerEvent("push", { data: { json: () => ({ url: "https://evil.example", body: "PATIENT_SECRET", title: "PATIENT_SECRET" }) } });
  await workerEvent("push", { data: { json: () => { throw new Error("malformed"); } } });
  await workerEvent("push", {});
  assert.equal(shown.length, 3);
  for (const item of shown) { assert.equal(item.title, "النور للمناظير الطبية"); assert.equal(item.options.body, "تم تفعيل إشعارات النور بنجاح."); assert.equal(item.options.data.url, "/operations"); }
  let closed = false;
  await workerEvent("notificationclick", { notification: { close: () => { closed = true; }, data: { url: "//evil.example" } } });
  assert.equal(closed, true); assert.equal(opened, "/operations");
  context.self.clients.matchAll = async () => [{ url: "https://alnoor.example/", navigate: async (path: string) => { navigated = path; return { focus: async () => { focused = true; } }; } }];
  await workerEvent("notificationclick", { notification: { close: () => {}, data: { url: "/operations" } } });
  assert.equal(navigated, "/operations"); assert.equal(focused, true);

  // Substitute only framework server boundary and authenticated-session lookup.
  const globalTest = globalThis as typeof globalThis & { pushTestActor?: typeof actor | null };
  globalTest.pushTestActor = actor;
  registerHooks({ resolve(specifier, context, next) {
    if (specifier === "web-push") return { url: "data:text/javascript," + encodeURIComponent('export default { async sendNotification(subscription,payload){globalThis.pushTestPayload=payload;if(globalThis.pushTestFailure)throw globalThis.pushTestFailure;return {statusCode:201};} };'), shortCircuit: true };
    if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
    if (specifier === "@/lib/auth/guards") return { url: "data:text/javascript," + encodeURIComponent('export class AuthenticationRequiredError extends Error {} export async function requireAuthenticatedUser(){if(!globalThis.pushTestActor)throw new AuthenticationRequiredError();return globalThis.pushTestActor;}'), shortCircuit: true };
    return next(specifier, context);
  }, load(url, context, next) {
    if (url.startsWith("data:text/javascript,")) return { format: "module", source: decodeURIComponent(url.slice("data:text/javascript,".length)), shortCircuit: true };
    return next(url, context);
  } });
  const { postgresClient } = await import("../src/db/client");
  const { pushActor, pushBody } = await import("../src/lib/push/api");
  const { saveSubscription, sessionSubscriptions, removeSubscription, removeExpiredSubscription } = await import("../src/lib/push/store");
  const request = (body: unknown = {}) => new Request("https://alnoor.example/api/v1/push/subscription", { method: "POST", headers: { origin: "https://alnoor.example", "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await pushActor(request(), true)).user.id, userId);
  globalTest.pushTestActor = { ...actor, user: { ...actor.user, role: { code: "employee" } } };
  await assert.rejects(pushActor(request(), true), (error: unknown) => !!error && typeof error === "object" && "status" in error && error.status === 403);
  globalTest.pushTestActor = null;
  await assert.rejects(pushActor(request(), true));
  globalTest.pushTestActor = actor;
  await assert.rejects(pushActor(new Request("https://alnoor.example/api/v1/push/subscription", { method: "POST", headers: { origin: "https://evil.example" } }), true));
  await assert.rejects(pushBody(request({ data: "x".repeat(9000) })));
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const original = postgresClient.unsafe;
  let stored = false;
  postgresClient.unsafe = (async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); if (sql.startsWith("INSERT")) { stored = true; return [{ id: "one" }]; } return []; }) as unknown as typeof original;
  try {
    assert.equal(await saveSubscription(actor, subscription, "browser"), true);
    assert.equal(await saveSubscription(actor, subscription, "browser"), true);
    assert.equal(stored, true);
    for (const call of calls) { assert.match(call.sql, /ON CONFLICT\(endpoint\) DO UPDATE/); assert.deepEqual(call.params.slice(0, 2), [userId, sessionId]); assert.match(call.sql, /push_subscriptions.p256dh=excluded.p256dh/); }
    await sessionSubscriptions(actor); const select = calls.at(-1)!;
    assert.match(select.sql, /p.user_id=\$1::uuid AND p.session_id=\$2::uuid/); assert.match(select.sql, /revoked_at IS NULL AND s.expires_at>now/);
    await removeSubscription(actor, subscription.endpoint); assert.deepEqual(calls.at(-1)!.params, [userId, sessionId, subscription.endpoint]);
    const row = { id: "33333333-3333-4333-8333-333333333333", endpoint: subscription.endpoint, ...subscription.keys, updatedAt: "2026-09-07 12:00:00+00" };
    await removeExpiredSubscription(actor, row); assert.match(calls.at(-1)!.sql, /updated_at=\$7::timestamptz/);
  } finally { postgresClient.unsafe = original; await postgresClient.end();  }
  // A public, deterministic test-only key fixture; never used for owner configuration.
  const { createECDH } = await import("node:crypto");
  const ec = createECDH("prime256v1"); const fixture = Buffer.alloc(32); fixture[31] = 1; ec.setPrivateKey(fixture);
  const envNames = ["NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "WEB_PUSH_VAPID_PRIVATE_KEY", "WEB_PUSH_VAPID_SUBJECT"] as const;
  const oldEnv = envNames.map(name => process.env[name]);
  process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY = ec.getPublicKey().toString("base64url");
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = fixture.toString("base64url");
  process.env.WEB_PUSH_VAPID_SUBJECT = "mailto:test@example.com";
  const provider = globalThis as typeof globalThis & { pushTestFailure?: unknown; pushTestPayload?: string };
  const row = { id: "33333333-3333-4333-8333-333333333333", endpoint: subscription.endpoint, ...subscription.keys, updatedAt: "2026-09-07 12:00:00+00" };
  postgresClient.unsafe = (async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return sql.startsWith("SELECT") ? [row] : sql.startsWith("INSERT") ? [{ id: row.id }] : []; }) as unknown as typeof original;
  try {
    const { sendSelfTest } = await import("../src/lib/push/server");
    const routes = await import("../src/app/api/v1/push/subscription/route");
    globalTest.pushTestActor = { ...actor, user: { ...actor.user, role: { code: "employee" } } };
    assert.equal((await routes.POST(request(subscription))).status, 403);
    for (const code of ["owner", "accountant"]) {
      globalTest.pushTestActor = { ...actor, user: { ...actor.user, role: { code } } };
      assert.equal((await routes.POST(request(subscription))).status, 200);
    }
    globalTest.pushTestActor = actor;
    assert.equal((await routes.POST(request({ ...subscription, user_id: "forged" }))).status, 400);
    assert.equal((await routes.DELETE(request({ endpoint: subscription.endpoint }))).status, 200);
    assert.deepEqual(calls.at(-1)!.params, [userId, sessionId, subscription.endpoint]);
    const status = await (await routes.GET(new Request("https://alnoor.example/api/v1/push/subscription"))).json();
    assert.equal(status.configured, true); assert.equal(status.endpointHashes.length, 1);
    assert.doesNotMatch(JSON.stringify(status), /privateKey|p256dh|auth|fcm.googleapis/);
    for (const code of [404, 410, 500, 429]) {
      calls.length = 0; provider.pushTestFailure = { statusCode: code };
      assert.equal(await sendSelfTest(actor, row), code === 404 || code === 410 ? "expired" : "failed");
      assert.equal(calls.filter(call => call.sql.startsWith("DELETE")).length, code === 404 || code === 410 ? 1 : 0);
    }
    delete provider.pushTestFailure;
    assert.equal(await sendSelfTest(actor, row), "accepted");
    assert.deepEqual(JSON.parse(provider.pushTestPayload!), testPayload);
    const manual = await import("../src/app/api/v1/push/test/route");
    assert.equal((await manual.POST(request({ user_id: "other" }))).status, 400);
    assert.equal((await manual.POST(request({}))).status, 200);
    assert.equal((await manual.POST(request({}))).status, 429);
  } finally {
    postgresClient.unsafe = original;
    envNames.forEach((name, index) => { if (oldEnv[index] === undefined) delete process.env[name]; else process.env[name] = oldEnv[index]; });
    delete globalTest.pushTestActor; delete provider.pushTestFailure; delete provider.pushTestPayload;
  }
  const client = readFileSync("src/components/push/push-notification-control.tsx", "utf8") + readFileSync("src/lib/push/client.ts", "utf8");
  assert.doesNotMatch(client, /VAPID_PRIVATE|web-push|register\(/);
  assert.match(readFileSync("src/lib/push/server.ts", "utf8"), /import "server-only"/);
  const testRoute = readFileSync("src/app/api/v1/push/test/route.ts", "utf8");
  assert.match(testRoute, /Object.keys\(body\).length/); assert.match(testRoute, /sessionSubscriptions\(actor\)/); assert.match(testRoute, /cooldown/);
  console.log("Push subscription contract: PASS (mock DB/auth and worker VM; no live delivery)");
}
void main();
