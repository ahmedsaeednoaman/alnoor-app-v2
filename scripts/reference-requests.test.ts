import assert from "node:assert/strict";
import { cacheRuntime, nodes } from "./cache-test-runtime";
import type { SmartSelect } from "../src/components/operations/smart-select";
import type { useSharedReference } from "../src/lib/shared-references";
import { createReferenceRequests } from "../src/lib/reference-requests";
import { createRequestScopeController } from "../src/lib/auth/client-request-scope";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const origin = "https://alnoor.test";
const option = { id: "one", name: "دكتور طويل الاسم" };
const response = () => Response.json({ items: [option] });
async function scope(name = "session-a") {
  const initial = { scope: name, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const controller = createRequestScopeController(initial, async () => initial, () => {});
  await controller.revalidate();
  return controller;
}
function network() {
  const requests: Array<{ url: string; signal: AbortSignal; result: ReturnType<typeof deferred<Response>> }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    assert.ok(init?.signal);
    const result = deferred<Response>();
    requests.push({ url: String(url), signal: init.signal, result });
    return result.promise; // Deliberately ignores abort to test late transport responses.
  };
  return { requests, coordinator: createReferenceRequests(fetcher) };
}
async function coordinatorTests() {
  const auth = await scope();
  const ticket = auth.capture()!;
  const net = network();
  const join = (url = "/api/references") => net.coordinator.subscribe(url, ticket, auth.isCurrent, origin);
  for (const count of [2, 3]) {
    const start = net.requests.length;
    const consumers = Array.from({ length: count }, () => join());
    await flush(); assert.equal(net.requests.length, start + 1);
    net.requests[start].result.resolve(response());
    for (const consumer of consumers) assert.deepEqual(await consumer.promise, [option]);
  }
  // Completion is not a cache; URL and exact parameters remain independent.
  const urls = ["/api/references", "/api/other", "/api/references?active=true", "/api/references?active=false"];
  const start = net.requests.length;
  const consumers = urls.map(join);
  await flush(); assert.equal(net.requests.length, start + 4);
  consumers.forEach((_, i) => net.requests[start + i].result.resolve(response()));
  await Promise.all(consumers.map(c => c.promise));
  const a = join(), b = join(), c = join(); await flush();
  const shared = net.requests.at(-1)!;
  a.release(); await assert.rejects(a.promise, { name: "AbortError" });
  assert.equal(shared.signal.aborted, false);
  shared.result.resolve(response()); await Promise.all([b.promise, c.promise]);
  const d = join(), e = join(); await flush();
  const abandoned = net.requests.at(-1)!;
  d.release(); e.release(); assert.equal(abandoned.signal.aborted, true);
  await Promise.all([assert.rejects(d.promise), assert.rejects(e.promise)]);
  const retry = join(); await flush();
  assert.notEqual(net.requests.at(-1), abandoned);
  abandoned.result.resolve(response()); net.requests.at(-1)!.result.resolve(response()); await retry.promise;
  for (const failure of ["network", "http", "json", "shape", "missing-items"]) {
    const first = join(), second = join(); await flush();
    const request = net.requests.at(-1)!;
    if (failure === "network") request.result.reject(new Error("offline"));
    else request.result.resolve(failure === "http" ? new Response("", { status: 403 }) :
      failure === "json" ? new Response("invalid") : failure === "missing-items" ? Response.json({}) : Response.json({ items: [{}] }));
    await Promise.all([assert.rejects(first.promise), assert.rejects(second.promise)]);
    const next = join(); await flush(); net.requests.at(-1)!.result.resolve(response()); await next.promise;
  }
  const old = join(); await flush(); const oldRequest = net.requests.at(-1)!;
  auth.invalidate(); await assert.rejects(old.promise, { name: "AbortError" });
  assert.equal(oldRequest.signal.aborted, true);
  assert.throws(() => join(), { name: "AbortError" });
  await auth.revalidate();
  const before = net.requests.length;
  const sameSession = net.coordinator.subscribe("/api/references", auth.capture()!, auth.isCurrent, origin);
  const other = await scope("session-b");
  const newLoginSameAccount = await scope("session-a-new-login");
  const different = net.coordinator.subscribe("/api/references", other.capture()!, other.isCurrent, origin);
  const newLogin = net.coordinator.subscribe("/api/references", newLoginSameAccount.capture()!, newLoginSameAccount.isCurrent, origin);
  await flush(); assert.equal(net.requests.length, before + 3);
  oldRequest.result.resolve(response());
  net.requests.slice(-3).forEach(r => r.result.resolve(response()));
  await Promise.all([sameSession.promise, different.promise, newLogin.promise]);
  auth.dispose(); other.dispose(); newLoginSameAccount.dispose();
  console.log("Coordinator: concurrency, identity, cancellation, retry, cleanup and scope isolation PASS");
}

// Real SmartSelect + SWR, with deterministic React host and mocked fetch.
type Element = ReturnType<typeof nodes>[number];
async function harness(multiple = false, pendingMutation?: ReturnType<typeof deferred<Response>>) {
  const runtime = await cacheRuntime(); await runtime.activate();
  const Select = runtime.api.SmartSelect as unknown as typeof SmartSelect;
  const useReference = runtime.api.useSharedReference as unknown as typeof useSharedReference;
  let endpoint = "/api/doctors", value: string | string[] = multiple ? [] : "";
  let serverOptions = [option], afterMutation = false;
  const answered = new Set<unknown>();
  const component = runtime.mount(() => Select({ label: "طبيب", type: "doctors", canCreate: true, canManage: true, value, multiple, optionsEndpoint: endpoint,
    onChange(next) { value = next; component.dirty = true; } }));
  const probe = runtime.mount(() => useReference(endpoint));
  const api = {
    auth: runtime.auth,
    get requests() { return runtime.requests.filter(request => request.method === "GET").map(request => ({ ...request, result: { resolve: request.resolve, reject: request.reject } })); },
    async flush() {
      for (let i = 0; i < 4; i++) {
        await runtime.flush();
        for (const request of runtime.requests) {
          if (answered.has(request)) continue;
          if (request.method !== "GET") {
            answered.add(request);
            if (pendingMutation) { void pendingMutation.promise.then(request.resolve); continue; }
            afterMutation = true;
            serverOptions = request.url.endsWith("/archive") ? [] : [{ id: "one", name: "الاسم الجديد" }];
            request.resolve(Response.json({ item: serverOptions[0] }));
          } else if (afterMutation) { answered.add(request); request.resolve(Response.json({ items: serverOptions })); }
        }
      }
    },
    nodes: () => nodes(component.value), value: () => value,
    changeEndpoint(next: string) { endpoint = next; component.dirty = true; probe.dirty = true; },
    async refreshOptions() { runtime.advance(60_001); probe.value.refreshIfStale(); await runtime.flush(); },
    unmount() { runtime.dispose(); },
    async invoke(match: (node: Element) => boolean, event = "onClick", argument: unknown = { stopPropagation() {} }) {
      await runtime.invoke(component, match, event, argument); await api.flush();
    },
  };
  await api.flush(); return api;
}
async function componentTests() {
  for (const mutation of ["add", "edit", "archive"]) {
    const h = await harness();
    h.requests[0].result.resolve(response()); await h.flush();
    await h.invoke(n => n.props.role === "combobox");
    await h.refreshOptions(); await h.flush(); // Same-generation refresh retains options.
    const stale = h.requests.at(-1)!;
    if (mutation === "add") {
      await h.invoke(n => n.props.role === "combobox", "onChange", { target: { value: "الاسم الجديد" } });
      await h.invoke(n => n.props.className === "smart-select__add");
    } else if (mutation === "edit") {
      await h.invoke(n => n.props.className === "smart-select__edit");
      await h.invoke(n => n.type === "button" && n.props.className === "primary");
    } else await h.invoke(n => n.props.className === "smart-select__archive");
    assert.equal(stale.signal?.aborted, true);
    stale.result.resolve(response()); await h.flush();
    await h.invoke(n => n.props.role === "combobox");
    const text = JSON.stringify(h.nodes().map(n => n.props.children));
    if (mutation === "archive") assert.equal(text.includes(option.name), false);
    else assert.ok(text.includes("الاسم الجديد"));
    h.unmount();
  }
  // A confirmed denial clears options and locks the scope without a 403 retry loop.
  const denied = await harness();
  denied.requests[0].result.resolve(response()); await denied.flush();
  await denied.refreshOptions(); await denied.flush();
  denied.requests.at(-1)!.result.resolve(new Response("", { status: 403 })); await denied.flush();
  assert.equal(denied.auth.capture(), null);
  assert.equal(JSON.stringify(denied.nodes()).includes(option.name), false);
  assert.equal(denied.requests.length, 2);
  denied.unmount();
  // Successful mutation responses from an invalidated session cannot select data.
  const mutationResult = deferred<Response>();
  const late = await harness(false, mutationResult);
  late.requests[0].result.resolve(response()); await late.flush();
  await late.invoke(n => n.props.role === "combobox", "onChange", { target: { value: "الاسم الجديد" } });
  await late.invoke(n => n.props.className === "smart-select__add");
  late.auth.invalidate();
  mutationResult.resolve(Response.json({ item: { id: "other-session", name: "الاسم الجديد" } }));
  await late.flush(); assert.equal(late.value(), ""); late.unmount();
  const single = await harness();
  single.requests[0].result.resolve(response()); await single.flush();
  await single.invoke(n => n.props.role === "combobox");
  await single.invoke(n => n.type === "button" && JSON.stringify(n.props.children).includes(option.name));
  assert.equal(single.value(), option.id);
  await single.invoke(n => n.props.className === "smart-select__clear");
  assert.equal(single.value(), "");
  single.unmount();
  const unmounted = await harness();
  unmounted.unmount();
  assert.equal(unmounted.requests[0].signal?.aborted, true);
  unmounted.requests[0].result.resolve(response()); await flush();
  const h = await harness(true);
  h.changeEndpoint("/api/hospitals"); await h.flush();
  h.requests[0].result.resolve(response());
  h.requests[1].result.resolve(Response.json({ items: [{ id: "hospital", name: "المستشفى" }] })); await h.flush();
  await h.invoke(n => n.props.role === "combobox");
  assert.equal(JSON.stringify(h.nodes()).includes(option.name), false);
  await h.invoke(n => n.type === "button" && JSON.stringify(n.props.children).includes("المستشفى"));
  assert.deepEqual(Array.from(h.value()), ["hospital"]);
  await h.invoke(n => n.props.className === "smart-select__clear-all");
  assert.equal(h.value().length, 0);
  h.unmount();
  console.log("SmartSelect: add/edit/archive stale GET protection, endpoint changes, multi-select and clear PASS");
}
async function main() { await coordinatorTests(); await componentTests(); }
void main().catch(error => { console.error(error); process.exitCode = 1; });
