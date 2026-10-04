import assert from "node:assert/strict";
import { authenticatedKey, createAuthenticatedCache, isFresh, REFERENCE_FRESH_MS, TEMPLATE_FRESH_MS } from "../src/lib/auth/authenticated-cache";
import { createRequestScopeController } from "../src/lib/auth/client-request-scope";

async function main() {
  let identity = { scope: "account-a-session-one", expiresAt: "2099-01-01T00:00:00Z" };
  const auth = createRequestScopeController(identity, async () => identity, () => {});
  const store = createAuthenticatedCache(auth), disconnect = store.connect();
  assert.equal(auth.capture(), null);
  store.cache.set("unverified", { data: "secret" }); assert.equal(store.cache.get("unverified"), undefined);
  await auth.revalidate();
  const ticket = auth.capture()!, key = authenticatedKey(ticket, "smart-options-v1", "/api/reference?a=1");
  const data = { value: [{ id: "one", name: "One" }], fetchedAt: 1000 };
  store.cache.set(key, { data }); assert.deepEqual(store.cache.get(key)?.data, data);
  const templateKey = authenticatedKey(ticket, "published-template-v1", "/api/v1/work-forms/lithotripsy");
  store.cache.set(templateKey, { data: { value: { id: "template", version: 1 }, fetchedAt: 1000 } });
  await auth.revalidate();
  assert.ok(auth.isCurrent(ticket), "same verified principal preserves generation and pending tickets");
  assert.deepEqual(store.cache.get(key)?.data, data);
  assert.ok(store.cache.get(templateKey)?.data, "same scope retains template cache too");
  assert.equal(store.cache.get(authenticatedKey(ticket, "smart-options-v1", "/api/reference?a=2")), undefined);
  assert.equal(store.cache.get(authenticatedKey(ticket, "published-template-v1", "/api/reference?a=1")), undefined);
  auth.invalidate(); assert.equal(store.cache.get(key), undefined); assert.equal([...store.cache.keys()].length, 0);
  store.cache.set(key, { data }); assert.equal([...store.cache.keys()].length, 0, "late SWR writes rejected");
  await auth.revalidate();
  assert.notEqual(auth.capture()!.generation, ticket.generation); assert.equal(store.cache.get(key), undefined);
  store.cache.set(key, { data }); assert.equal([...store.cache.keys()].length, 0);
  for (const name of ["account-b", "account-a-new-session", "account-a-permissions-changed"]) {
    identity = { ...identity, scope: name }; await auth.revalidate();
    assert.equal(auth.capture(), null); assert.equal(store.cache.get(key), undefined);
  }
  assert.equal(isFresh(data, REFERENCE_FRESH_MS, 60_999), true);
  assert.equal(isFresh(data, REFERENCE_FRESH_MS, 61_000), false);
  assert.equal(isFresh(data, TEMPLATE_FRESH_MS, 301_000), false);
  disconnect(); auth.dispose();
  console.log("Authenticated SWR store: unresolved gating, contracts, generations, logout, accounts, permissions, late writes, cleanup and freshness PASS");
}
void main();
