import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cacheRuntime, nodes } from "./cache-test-runtime";
import { accountantPermissions, employeePermissions, permissionCatalog } from "../src/db/rbac-definitions";
import type { SmartSelect } from "../src/components/operations/smart-select";
import type { WorkFormRenderer } from "../src/components/operations/work-form-renderer";
import type { BuilderTemplate } from "../src/components/operations/work-form-types";
import type { useSharedReference } from "../src/lib/shared-references";
import type { InlineReferenceSource } from "../src/lib/work-forms/inline-reference-sources";

type SelectProps = Parameters<typeof SmartSelect>[0];
const input = (node: ReturnType<typeof nodes>[number]) => node.props.role === "combobox";
const add = (node: ReturnType<typeof nodes>[number]) => node.props.className === "smart-select__add";
const original = { id: "one", name: "محمد   أحمد" };
const created = { id: "new", name: "New Reference" };
async function main() {
  const r = await cacheRuntime(); await r.activate();
  const Select = r.api.SmartSelect as unknown as typeof SmartSelect;
  const Renderer = r.api.WorkFormRenderer as unknown as typeof WorkFormRenderer;
  // Execute real renderer/FieldControl wiring, including the default used by
  // edit/detail-edit. The mocked host is not an Android/DOM behavior test.
  for (const [role, grants] of [["Owner", permissionCatalog.map(item => item.code)], ["Employee", employeePermissions], ["Accountant", accountantPermissions], ["No create", ["catalogs.manage"]]] as const) {
    for (const source of ["doctors", "hospitals", "procedures", "equipment", "consumables", "stents", "anesthesia_types", "anesthesiologists", "technicians", "contract_entities", "users"]) {
      const template = { sections: [{ id: "section", fields: [{ id: "field", stableKey: "doctor", label: "Doctor", fieldType: "smart_single", smartDropdownSource: source, showInForm: true }] }] } as BuilderTemplate;
      const canCreate = (grants as readonly string[]).includes("operations.create");
      const canManage = (grants as readonly string[]).includes("catalogs.manage");
      const renderer = r.mount(() => Renderer({ template, values: {}, errors: {}, canCreateReferences: canCreate, canManageCatalogs: canManage, onChange() {} }));
      await r.flush();
      const field = nodes(renderer.value).find(node => node.props.field)!;
      const fieldControl = r.mount(() => (field.type as (props: unknown) => unknown)(field.props)); await r.flush();
      const props = nodes(fieldControl.value)[0].props as SelectProps;
      assert.equal(props.canCreate, canCreate && source !== "users", `${role}/${source}`);
      assert.equal(props.canManage, canManage && source !== "users");
      const selector = r.mount(() => Select(props)); await r.flush();
      await r.invoke(selector, input, "onChange", { target: { value: "Missing" } });
      assert.equal(nodes(selector.value).some(add), canCreate && source !== "users");
      r.unmount(selector); r.unmount(fieldControl); r.unmount(renderer);
    }
  }
  // Edit renderers do not opt into creation, even if a future caller sets manage.
  const editTemplate = { sections: [{ id: "s", fields: [{ id: "f", stableKey: "doctor", fieldType: "smart_single", smartDropdownSource: "doctors", showInForm: true }] }] } as BuilderTemplate;
  const editRenderer = r.mount(() => Renderer({ template: editTemplate, values: {}, errors: {}, canManageCatalogs: false, onChange() {} }));
  await r.flush();
  const field = nodes(editRenderer.value).find(node => node.props.field)!;
  const editControl = r.mount(() => (field.type as (props: unknown) => unknown)(field.props)); await r.flush();
  assert.equal(nodes(editControl.value)[0].props.canCreate, false);
  r.dispose();

  for (const [source, catalog] of [["doctors", "doctors"], ["contract_entities", "contract-entities"], ["anesthesia_types", "anesthesia-types"]] as const) {
    const x = await cacheRuntime(); await x.activate();
    const Component = x.api.SmartSelect as unknown as typeof SmartSelect;
    const hook = x.api.useSharedReference as unknown as typeof useSharedReference;
    const endpoint = `/api/v1/work-forms/references/${source}`;
    let value: string | string[] = "";
    const selector = x.mount(() => Component({ label: "Reference", type: catalog, inlineCreateSource: source, optionsEndpoint: endpoint,
      value, canCreate: true, canManage: false, onChange(next) { value = next; selector.dirty = true; } }));
    const probe = x.mount(() => hook(endpoint));
    const alias = x.mount(() => hook(`/api/v1/catalogs/${catalog}?active=true&limit=50`));
    await x.flush();
    x.requests.forEach(request => request.resolve(Response.json({ items: [original] }))); await x.flush();
    await x.invoke(selector, input, "onChange", { target: { value: " محمد أحمد " } });
    assert.equal(nodes(selector.value).some(add), false, "same normalization for option + input");
    assert.equal(nodes(selector.value).some(node => node.props.className === "smart-select__edit" || node.props.className === "smart-select__archive"), false);
    x.advance(60_001); probe.value.refreshIfStale(); await x.flush(); const oldGet = x.requests.at(-1)!;
    await x.invoke(selector, input, "onChange", { target: { value: " New   Reference " } });
    await x.invoke(selector, add); const post = x.requests.at(-1)!;
    assert.equal(post.url, endpoint); assert.equal(post.method, "POST"); assert.deepEqual(JSON.parse(post.body!), { name: "New Reference" });
    assert.equal(nodes(selector.value).some(add), false, "busy hides Add");
    post.resolve(Response.json(created)); await x.flush();
    assert.equal(value, created.id); assert.equal(oldGet.signal?.aborted, true);
    assert.equal(nodes(selector.value).find(input)?.props.value, created.name, "immediate selected label, before revalidation");
    oldGet.resolve(Response.json({ items: [original] })); await x.flush();
    assert.equal(value, created.id);
    assert.equal(nodes(selector.value).find(input)?.props.value, created.name, "pre-POST GET cannot remove new selection");
    for (const request of x.requests.slice(-2)) request.resolve(Response.json({ items: [original, created] })); await x.flush();
    assert.equal(probe.value.data?.at(-1)?.id, created.id); assert.equal(alias.value.data?.at(-1)?.id, created.id);
    x.dispose();
  }

  // Capacity checked before POST and again against the latest controlled value.
  const m = await cacheRuntime(); await m.activate();
  const Multi = m.api.SmartSelect as unknown as typeof SmartSelect;
  let selected: string | string[] = ["one"];
  const multi = m.mount(() => Multi({ label: "Multi", type: "doctors", inlineCreateSource: "doctors", multiple: true, maxSelections: 1,
    optionsEndpoint: "/api/v1/work-forms/references/doctors", canCreate: true, canManage: false, value: selected,
    onChange(next) { selected = next; multi.dirty = true; } }));
  await m.flush(); m.requests[0].resolve(Response.json({ items: [original] })); await m.flush();
  await m.invoke(multi, input, "onChange", { target: { value: "Missing" } }); await m.invoke(multi, add);
  assert.equal(m.requests.filter(request => request.method === "POST").length, 0, "no unnecessary create at capacity");
  selected = []; multi.dirty = true; await m.flush(); await m.invoke(multi, add);
  const pending = m.requests.at(-1)!;
  selected = ["one"]; multi.dirty = true; await m.flush(); pending.resolve(Response.json(created)); await m.flush();
  assert.equal(JSON.stringify(selected), JSON.stringify(["one"]), "in-flight choice cannot be overwritten/exceed max");
  m.requests.at(-1)!.resolve(Response.json({ items: [original] })); await m.flush();
  selected = []; multi.dirty = true; await m.flush(); await m.invoke(multi, add);
  const duplicate = m.requests.at(-1)!;
  selected = [created.id]; multi.dirty = true; await m.flush(); duplicate.resolve(Response.json(created)); await m.flush();
  assert.equal(JSON.stringify(selected), JSON.stringify([created.id]), "a returned existing ID never duplicates or toggles off");
  m.dispose();

  // Generic catalog/financial creation still requires explicit management;
  // operations.create is never read or translated within SmartSelect.
  const f = await cacheRuntime(); await f.activate();
  const Financial = f.api.SmartSelect as unknown as typeof SmartSelect;
  let description: string | string[] = "";
  const denied = f.mount(() => Financial({ label: "Finance", type: "financial-items", value: "", canCreate: true, canManage: false, onChange() {} }));
  const financial = f.mount(() => Financial({ label: "Finance", type: "financial-items", value: description, returnLabel: true, canCreate: true, canManage: true,
    onChange(next) { description = next; financial.dirty = true; } }));
  await f.flush(); f.requests[0].resolve(Response.json({ items: [] })); await f.flush();
  await f.invoke(denied, input, "onChange", { target: { value: "Charge" } }); assert.equal(nodes(denied.value).some(add), false);
  await f.invoke(financial, input, "onChange", { target: { value: "Charge" } }); await f.invoke(financial, add);
  assert.equal(f.requests.at(-1)!.url, "/api/v1/catalogs/financial-items");
  assert.deepEqual(JSON.parse(f.requests.at(-1)!.body!), { name: "Charge", defaultKind: "financial", defaultAmount: 0 });
  f.requests.at(-1)!.resolve(Response.json({ item: { id: "financial", name: "Charge" } })); await f.flush();
  assert.equal(description, "Charge"); f.dispose();

  for (const change of ["logout", "account-switch"]) {
    const x = await cacheRuntime(); await x.activate();
    const Component = x.api.SmartSelect as unknown as typeof SmartSelect;
    let changes = 0;
    const selector = x.mount(() => Component({ label: "Doctor", type: "doctors", inlineCreateSource: "doctors" as InlineReferenceSource,
      value: "", canCreate: true, canManage: false, onChange() { changes++; } }));
    await x.flush(); const pendingGet = x.requests[0];
    await x.invoke(selector, input, "onChange", { target: { value: "Pending" } }); await x.invoke(selector, add); const pendingPost = x.requests.at(-1)!;
    if (change === "logout") x.auth.invalidate(); else await x.changeIdentity("different-principal");
    pendingGet.resolve(Response.json({ items: [original] })); pendingPost.resolve(Response.json(created)); await x.flush();
    assert.equal(changes, 0); assert.equal([...x.store.cache.keys()].length, 0);
    assert.equal(JSON.stringify(nodes(selector.value)).includes(original.name), false);
    x.dispose();
  }
  const page = readFileSync("src/app/(shell)/operations/new/page.tsx", "utf8");
  assert.ok(page.includes('canCreateReferences={auth.user.permissions.includes("operations.create")}'));
  assert.ok(readFileSync("src/components/operations/operation-editor.tsx", "utf8").includes("canManageCatalogs={false}"));
  assert.ok(readFileSync("src/components/operations/operation-details.tsx", "utf8").includes("canManageCatalogs={false}"));
  console.log("Inline reference client PASS: role/source capability wiring, normalized Add, name-only POST, immediate selection, alias propagation, late GET, max/duplicate selection, finance isolation, logout/account switch (real SWR; mocked React host)");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
