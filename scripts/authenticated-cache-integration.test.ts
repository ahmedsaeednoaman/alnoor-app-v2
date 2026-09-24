import assert from "node:assert/strict";
import { cacheRuntime, nodes } from "./cache-test-runtime";
import type { SmartSelect } from "../src/components/operations/smart-select";
import type { useSharedReference } from "../src/lib/shared-references";

const endpoint = "/api/v1/work-forms/references/doctors";
const generic = "/api/v1/catalogs/doctors?active=true&limit=50";
const hospital = "/api/v1/work-forms/references/hospitals";
const original = [{ id: "one", name: "Original" }, { id: "two", name: "Second" }];
async function main() {
  const r = await cacheRuntime(); await r.activate();
  const Select = r.api.SmartSelect as unknown as typeof SmartSelect;
  const useReference = r.api.useSharedReference as unknown as typeof useSharedReference;
  let single: string | string[] = "one", multi: string | string[] = ["one"];
  const first = r.mount(() => Select({ label: "Doctor", type: "doctors", optionsEndpoint: endpoint, value: single, canManage: true,
    onChange(value) { single = value; first.dirty = true; } }));
  const second = r.mount(() => Select({ label: "Doctors", type: "doctors", optionsEndpoint: endpoint, value: multi, multiple: true, canManage: true,
    onChange(value) { multi = value; second.dirty = true; } }));
  const probe = r.mount(() => useReference(endpoint));
  const catalog = r.mount(() => useReference(generic)); r.mount(() => useReference(hospital));
  await r.flush(); assert.equal(r.requests.length, 3);
  r.requests.forEach(request => request.resolve(Response.json({ items: original }))); await r.flush();
  await r.invoke(first, node => node.props.role === "combobox", "onChange", { target: { value: "Added" } });
  await r.invoke(first, node => node.props.className === "smart-select__add");
  const added = { id: "three", name: "Added" };
  r.requests.at(-1)!.resolve(Response.json({ item: added })); await r.flush();
  assert.equal(single, "three"); assert.deepEqual(multi, ["one"]);
  for (const request of r.requests.slice(-2)) request.resolve(Response.json({ items: [...original, added] })); await r.flush();
  assert.equal(probe.value.data?.length, 3); assert.equal(catalog.value.data?.length, 3);
  assert.equal(r.requests.filter(request => request.method === "GET" && request.url.endsWith(hospital)).length, 1);
  await r.invoke(second, node => node.props.role === "combobox");
  r.advance(60_001); probe.value.refreshIfStale(); await r.flush(); const preArchive = r.requests.at(-1)!;
  await r.invoke(second, node => node.props["aria-label"] === "أرشفة Original");
  r.requests.at(-1)!.resolve(Response.json({})); await r.flush();
  assert.equal(preArchive.signal?.aborted, true);
  preArchive.resolve(Response.json({ items: original }));
  for (const request of r.requests.slice(-2)) request.resolve(Response.json({ items: [original[1], added] })); await r.flush();
  assert.deepEqual(multi, ["one"], "archive preserves selected IDs");
  assert.ok(JSON.stringify(nodes(second.value)).includes("Original"), "archived selected label retained");
  assert.equal(probe.value.data?.some(item => item.id === "one"), false, "archive excluded from available options");
  assert.equal(single, "three");
  r.advance(60_001); probe.value.refreshIfStale(); await r.flush(); const preEdit = r.requests.at(-1)!;
  await r.invoke(first, node => node.props["aria-label"] === "تعديل Added");
  await r.invoke(first, node => node.type === "input" && node.props.autoFocus === true, "onChange", { target: { value: "Edited" } });
  await r.invoke(first, node => node.type === "button" && node.props.className === "primary");
  r.requests.at(-1)!.resolve(Response.json({ item: { ...added, name: "Edited" } })); await r.flush();
  assert.equal(preEdit.signal?.aborted, true); preEdit.resolve(Response.json({ items: [...original, added] }));
  for (const request of r.requests.slice(-2)) request.resolve(Response.json({ items: [original[1], { ...added, name: "Edited" }] })); await r.flush();
  assert.equal(probe.value.data?.find(item => item.id === "three")?.name, "Edited");
  assert.equal(catalog.value.data?.find(item => item.id === "three")?.name, "Edited");
  assert.ok(JSON.stringify(nodes(second.value)).includes("Edited"), "other mounted consumer sees edit");
  assert.equal(single, "three"); assert.deepEqual(multi, ["one"]);
  await r.invoke(first, node => node.props["aria-label"] === "تعديل Edited");
  assert.ok(nodes(first.value).some(node => node.props.role === "dialog"));
  r.auth.deny(); await r.flush();
  assert.equal(nodes(first.value).some(node => node.props.role === "dialog"), false, "old inline editor is hidden on denial");
  assert.equal(r.auth.getSnapshot().reason, "access-denied");
  await r.activate();
  assert.equal(nodes(first.value).some(node => node.props.role === "dialog"), false, "editor cannot revive in a new generation");
  // A permission identity change must block the old protected tree and empty SWR.
  await r.changeIdentity("account-a-permissions-changed");
  assert.equal(r.auth.capture(), null); assert.equal(probe.value.data, undefined); assert.equal([...r.store.cache.keys()].length, 0);
  assert.equal(JSON.stringify(nodes(second.value)).includes("Original"), false, "no retained labels exposed outside verified scope");
  r.dispose();
  for (const identity of ["account-b", "account-a-new-session"]) {
    const next = await cacheRuntime(identity); await next.activate(); const hook = next.api.useSharedReference as unknown as typeof useSharedReference;
    const consumer = next.mount(() => hook(endpoint)); await next.flush();
    assert.equal(next.requests.length, 1); assert.equal(consumer.value.data, undefined);
    next.requests[0].resolve(Response.json({ items: [{ id: identity, name: identity }] })); await next.flush();
    assert.equal(JSON.stringify(consumer.value.data), JSON.stringify([{ id: identity, name: identity }])); next.dispose();
  }
  console.log("Integrated SmartSelect / real SWR: add propagation, edit/archive late-GET rejection, archived selections, targeted aliases, permission changes and new logins PASS (mocked React host)");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
