import assert from "node:assert/strict";
import { createOperationDetailRequests, OperationDetailRequestError } from "../src/lib/operations/detail-requests";
import { createRequestScopeController } from "../src/lib/auth/client-request-scope";

async function main() {
  const identity = { scope: "test-account", expiresAt: "2099-01-01T00:00:00Z" };
  const auth = createRequestScopeController(identity, async () => identity, () => {});
  await auth.revalidate();
  const requests: Array<{ resolve: (r: Response) => void; signal: AbortSignal }> = [];
  const read = createOperationDetailRequests(async (_url, init) => new Promise(resolve => requests.push({ resolve, signal: init!.signal as AbortSignal })));
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  const ticket = auth.capture()!;
  const first = read("one", ticket, auth.isCurrent), second = read("one", ticket, auth.isCurrent);
  assert.equal(first, second); await flush(); assert.equal(requests.length, 1);
  requests[0].resolve(Response.json({ operation: { id: "one" } })); await first;
  const reopen = read("one", ticket, auth.isCurrent); await flush(); assert.equal(requests.length, 2, "completed DTO not cached");
  const cancelled = assert.rejects(reopen, { name: "AbortError" });
  const afterPatch = read("one", ticket, auth.isCurrent, true); await flush();
  assert.equal(requests[1].signal.aborted, true); assert.equal(requests.length, 3);
  requests[1].resolve(Response.json({ operation: { id: "old" } }));
  requests[2].resolve(Response.json({ operation: { id: "new" } }));
  await cancelled; assert.deepEqual(await afterPatch, { operation: { id: "new" } });
  const old = read("two", ticket, auth.isCurrent); const rejected = assert.rejects(old, { name: "AbortError" });
  await flush(); auth.deny(); await rejected;
  assert.equal(requests[3].signal.aborted, true);
  requests[3].resolve(Response.json({ operation: { id: "late" } }));
  await auth.revalidate();
  const next = read("two", auth.capture()!, auth.isCurrent); const denied = assert.rejects(next, OperationDetailRequestError);
  await flush(); requests[4].resolve(Response.json({ error: { message: "Denied" } }, { status: 403 })); await denied;
  auth.dispose();
  console.log("Operation detail requests PASS: concurrent/replayed load 2→1 GET, no completed cache, post-mutation supersession, logout cancellation, generation isolation, late-response rejection, 403 (mock fetch)");
}
void main();
