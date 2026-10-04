import assert from "node:assert/strict";
import { listenForScopeLifecycle } from "../src/lib/auth/client-request-scope";
import { cacheRuntime } from "./cache-test-runtime";
import type { useSharedReference } from "../src/lib/shared-references";

async function main() {
  const r = await cacheRuntime();
  const useReference = r.api.useSharedReference as unknown as typeof useSharedReference;
  const item = r.mount(() => useReference("/api/v1/work-forms/references/doctors"));
  await r.activate();
  r.requests[0].resolve(Response.json({ items: [{ id: "one", name: "Doctor" }] }));
  await r.flush();
  const ticket = r.auth.capture()!;
  const saved = item.value.data;
  const win = new EventTarget(), doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const frames = new Map<number, FrameRequestCallback>(); let next = 0, checks = 0;
  Object.assign(win, { requestAnimationFrame: (cb: FrameRequestCallback) => { frames.set(++next, cb); return next; }, cancelAnimationFrame: (id: number) => frames.delete(id) });
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window"), oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: win });
    Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
    const drain = async () => { for (const [id, cb] of [...frames]) { frames.delete(id); cb(0); } await r.flush(); };
    const stop = listenForScopeLifecycle(async () => { checks++; await r.auth.revalidate(); });
    await drain();
    for (const scenario of ["focus", "visibilitychange", "pageshow", "online"]) {
      win.dispatchEvent(new Event("blur"));
      doc.visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange"));
      win.dispatchEvent(new Event("pagehide"));
      assert.ok(r.auth.isCurrent(ticket)); assert.equal(item.value.data, saved);
      doc.visibilityState = "visible";
      (scenario === "visibilitychange" ? doc : win).dispatchEvent(new Event(scenario));
      win.dispatchEvent(new Event("focus")); win.dispatchEvent(new Event("pageshow"));
      assert.equal(frames.size, 1, "coalesce related resume events");
      await drain();
      assert.ok(r.auth.isCurrent(ticket));
      assert.equal(item.value.data, saved); assert.equal(r.requests.length, 1, "no cold reference GET after verification");
    }
    assert.equal(checks, 5);
    stop(); win.dispatchEvent(new Event("focus")); assert.equal(frames.size, 0);
    await r.changeIdentity("changed-permissions");
    assert.equal(r.auth.isCurrent(ticket), false); assert.equal(ticket.signal.aborted, true);
    assert.equal(item.value.data, undefined); assert.equal([...r.store.cache.keys()].length, 0);
  } finally {
    for (const [key, descriptor] of [["window", oldWindow], ["document", oldDocument]] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
    r.dispose();
  }
  console.log("Scope lifecycle PASS: focus/blur, hidden/visible, pagehide/pageshow, online coalescing, same-generation real SWR retention (+0 reference GET), permission-change eviction (mock browser host)");
}
void main();
