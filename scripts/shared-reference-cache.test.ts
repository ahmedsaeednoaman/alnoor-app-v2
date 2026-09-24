import assert from "node:assert/strict";
import { cacheRuntime } from "./cache-test-runtime";
import type { useSharedReference } from "../src/lib/shared-references";

const doctors = "/api/v1/work-forms/references/doctors";
const hospitals = "/api/v1/work-forms/references/hospitals";
const generic = "/api/v1/catalogs/doctors?active=true&limit=50";
const body = { items: [{ id: "one", name: "Doctor" }] };
async function main() {
  const r = await cacheRuntime();
  const useReference = r.api.useSharedReference as unknown as typeof useSharedReference;
  const first = r.mount(() => useReference(doctors)); await r.flush();
  assert.equal(r.requests.length, 0, "no GET while scope unresolved");
  await r.activate();
  const second = r.mount(() => useReference(doctors)), third = r.mount(() => useReference(doctors));
  await r.flush(); assert.equal(r.requests.length, 1, "three consumers = one GET");
  r.unmount(first); assert.equal(r.requests[0].signal?.aborted, false);
  r.requests[0].resolve(Response.json(body)); await r.flush();
  assert.equal(second.value.data?.[0].name, "Doctor"); assert.equal(third.value.data?.[0].name, "Doctor");
  r.unmount(second); r.unmount(third);
  const remount = r.mount(() => useReference(doctors)); await r.flush();
  assert.equal(r.requests.length, 1, "completed result reused on navigation/type remount");
  const hospital = r.mount(() => useReference(hospitals)), catalog = r.mount(() => useReference(generic));
  await r.flush(); assert.equal(r.requests.length, 3, "source and response slices remain independent");
  r.requests[1].resolve(Response.json(body)); r.requests[2].resolve(Response.json(body)); await r.flush();
  for (const type of ["endoscopy", "contract", "lithotripsy"]) {
    const consumer = r.mount(() => useReference(doctors)); await r.flush();
    assert.equal(r.requests.length, 3, `${type} reuses shared source`); r.unmount(consumer);
  }
  r.advance(60_001); remount.value.refreshIfStale(); await r.flush();
  assert.equal(r.requests.length, 4); const stale = r.requests[3];
  const mutation = remount.value.invalidateCatalog("doctors", r.auth.capture()!); await r.flush();
  assert.equal(stale.signal?.aborted, true);
  assert.equal(r.requests.length, 6, "only doctor work-form + generic aliases refreshed");
  stale.resolve(Response.json(body));
  for (const request of r.requests.slice(4)) request.resolve(Response.json({ items: [{ id: "new", name: "Confirmed" }] }));
  await mutation; await r.flush();
  assert.equal(remount.value.data?.[0].name, "Confirmed"); assert.equal(catalog.value.data?.[0].name, "Confirmed");
  assert.equal(hospital.value.data?.[0].name, "Doctor", "unrelated source untouched");
  r.advance(60_001); remount.value.refreshIfStale(); await r.flush();
  r.requests.at(-1)!.reject(new Error("offline")); await r.flush();
  assert.equal(remount.value.data?.[0].name, "Confirmed", "network error preserves usable data");
  remount.value.refreshIfStale(); await r.flush(); r.requests.at(-1)!.resolve(Response.json(body)); await r.flush();
  assert.equal(remount.value.data?.[0].name, "Doctor", "failure can retry");
  r.auth.invalidate(); await r.flush();
  assert.equal(remount.value.data, undefined); assert.equal([...r.store.cache.keys()].length, 0);
  await r.activate(); await r.flush();
  const old = r.requests.at(-1)!; r.auth.invalidate(); old.resolve(Response.json(body)); await r.flush();
  assert.equal([...r.store.cache.keys()].length, 0, "logout rejects late writes");
  r.dispose();
  for (const status of [401, 403]) {
    const denied = await cacheRuntime(); await denied.activate();
    const hook = denied.api.useSharedReference as unknown as typeof useSharedReference;
    const consumer = denied.mount(() => hook(doctors)); await denied.flush();
    denied.requests[0].resolve(Response.json(body)); await denied.flush();
    denied.advance(60_001); consumer.value.refreshIfStale(); await denied.flush();
    denied.requests[1].resolve(new Response("", { status })); await denied.flush();
    assert.equal(consumer.value.data, undefined); assert.equal(denied.auth.capture(), null);
    assert.equal([...denied.store.cache.keys()].length, 0); assert.equal(denied.requests.length, 2, "no denial retry loop"); denied.dispose();
  }
  console.log("Shared references / real SWR: concurrent 3→1; remount/type switches +0; aliases isolated; mutation races, retry, denial, logout PASS (mocked React host)");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
