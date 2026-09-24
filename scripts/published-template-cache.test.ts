import assert from "node:assert/strict";
import { cacheRuntime, nodes } from "./cache-test-runtime";
import type { OperationForm } from "../src/components/operations/operation-form";
import type { BuilderTemplate } from "../src/components/operations/work-form-types";
import type { WorkFormValues } from "../src/components/operations/work-form-rendering";
import type { OperationType } from "../src/lib/work-forms/types";
import type { usePublishedTemplate } from "../src/lib/work-forms/published-template-cache";

function template(operationType: OperationType, version = 1): BuilderTemplate {
  return { id: `${operationType}-${version}`, operationType, version, status: "published", name: operationType, updatedAt: "2026-01-01", sections: [{
    id: "section", stableKey: "case", label: "Case", description: null, sortOrder: 0, isSystemSection: false, archivedAt: null, fields: [{
      id: "notes", sectionId: "section", stableKey: "notes", label: "Notes", description: null, fieldType: "text", required: false, multiple: false,
      sortOrder: 0, isSystemField: false, smartDropdownSource: null, minSelections: null, maxSelections: null, showInForm: true,
      showInDetails: false, showInFinancialReview: false, showInPrint: false, isFinancial: false, financialEffect: null, archivedAt: null,
    }],
  }] };
}
function renderer(tree: unknown) {
  return nodes(tree).find(node => "values" in node.props && "template" in node.props)?.props as
    { template: BuilderTemplate; values: WorkFormValues; onChange: (key: string, value: string) => void } | undefined;
}
async function main() {
  const r = await cacheRuntime(); await r.activate();
  const Form = r.api.OperationForm as unknown as typeof OperationForm;
  const useTemplate = r.api.usePublishedTemplate as unknown as typeof usePublishedTemplate;
  const form = r.mount(() => Form({ canManageCatalogs: true, canManageWorkForms: true }));
  await r.flush(); assert.equal(r.requests.length, 1);
  r.requests[0].resolve(Response.json({ template: template("lithotripsy") })); await r.flush();
  assert.equal(renderer(form.value)?.template.id, "lithotripsy-1");
  renderer(form.value)!.onChange("notes", "entered case value"); await r.flush();
  const probe = r.mount(() => useTemplate("lithotripsy")); await r.flush(); assert.equal(r.requests.length, 1);
  r.advance(300_001); probe.value.refreshIfStale(); await r.flush(); assert.equal(r.requests.length, 2);
  r.requests[1].resolve(Response.json({ template: template("lithotripsy", 2) })); await r.flush();
  assert.equal(probe.value.data?.version, 2, "shared cache accepts new published version");
  assert.equal(renderer(form.value)?.template.version, 1, "open form pinned");
  assert.equal(renderer(form.value)?.values.notes, "entered case value", "dirty values preserved");
  assert.equal(JSON.stringify([...r.store.cache.keys()].map(key => r.store.cache.get(key))).includes("entered case value"), false);
  r.advance(300_001); probe.value.refreshIfStale(); await r.flush(); r.requests.at(-1)!.reject(new Error("offline")); await r.flush();
  assert.equal(renderer(form.value)?.values.notes, "entered case value", "background failure preserves dirty form");
  assert.equal(renderer(form.value)?.template.version, 1);
  // Restore freshness for switch-back checks.
  probe.value.refreshIfStale(); await r.flush(); r.requests.at(-1)!.resolve(Response.json({ template: template("lithotripsy", 2) })); await r.flush();
  const formNode = nodes(form.value).find(node => node.type === "form")!;
  const submission = (formNode.props.onSubmit as (event: { preventDefault(): void }) => Promise<void>)({ preventDefault() {} });
  await r.flush();
  const post = r.requests.at(-1)!;
  assert.equal(post.method, "POST");
  assert.deepEqual(JSON.parse(post.body!), { operationType: "lithotripsy", formTemplateId: "lithotripsy-1", values: { notes: "entered case value" } });
  post.resolve(Response.json({})); await submission; await r.flush();
  // Publishing invalidates rather than caching a manager response, and wins
  // over a GET that was already in flight when publication succeeded.
  r.advance(300_001); probe.value.refreshIfStale(); await r.flush(); const beforePublish = r.requests.at(-1)!;
  await r.invoke(form, node => node.props.className === "work-form-settings-button");
  const builder = nodes(form.value).find(node => typeof node.props.onPublished === "function")!;
  (builder.props.onPublished as (next: BuilderTemplate) => void)({ ...template("lithotripsy", 3), managerOnly: "never-cache-manager-response" } as BuilderTemplate);
  await r.flush();
  beforePublish.resolve(Response.json({ template: template("lithotripsy", 2) }));
  r.requests.at(-1)!.resolve(Response.json({ template: template("lithotripsy", 3) })); await r.flush();
  assert.equal(renderer(form.value)?.template.version, 3);
  assert.equal(probe.value.data?.version, 3);
  assert.equal(JSON.stringify([...r.store.cache.keys()].map(key => r.store.cache.get(key))).includes("never-cache-manager-response"), false);
  renderer(form.value)!.onChange("notes", "dirty after publication"); await r.flush();
  const beforeTypes = r.requests.length;
  r.setConfirm(false);
  await r.invoke(form, node => node.props.role === "tab" && node.props.children === "مناظير");
  assert.equal(renderer(form.value)?.template.operationType, "lithotripsy"); assert.equal(r.requests.length, beforeTypes);
  r.setConfirm(true);
  await r.invoke(form, node => node.props.role === "tab" && node.props.children === "مناظير");
  const endoscopyRequest = r.requests.at(-1)!;
  await r.invoke(form, node => node.props.role === "tab" && node.props.children === "تعاقد");
  const contractRequest = r.requests.at(-1)!;
  contractRequest.resolve(Response.json({ template: template("contract") })); await r.flush();
  endoscopyRequest.resolve(Response.json({ template: template("endoscopy") })); await r.flush();
  assert.equal(renderer(form.value)?.template.operationType, "contract", "late endoscopy cannot replace contract");
  await r.invoke(form, node => node.props.role === "tab" && node.props.children === "تفتيت");
  assert.equal(renderer(form.value)?.template.id, "lithotripsy-3", "return adopts latest eligible cached schema");
  assert.equal(r.requests.length, beforeTypes + 2, "three types, only two new GETs; return +0");
  await r.invoke(form, node => node.props.role === "tab" && node.props.children === "مناظير");
  assert.equal(renderer(form.value)?.template.operationType, "endoscopy");
  assert.equal(r.requests.length, beforeTypes + 2, "late response can warm its own type cache");
  r.unmount(form);
  const returning = r.mount(() => Form({ canManageCatalogs: false, canManageWorkForms: false })); await r.flush();
  assert.equal(renderer(returning.value)?.template.id, "lithotripsy-3"); assert.equal(r.requests.length, beforeTypes + 2);
  assert.ok(r.requests.every(request => !request.url.includes("draft")), "no draft warming");
  r.dispose();
  // Wrong-type and draft responses cannot become usable schemas.
  for (const invalid of [{ ...template("lithotripsy"), status: "draft" }, template("contract")]) {
    const f = await cacheRuntime(); await f.activate(); const hook = f.api.usePublishedTemplate as unknown as typeof usePublishedTemplate;
    const consumer = f.mount(() => hook("lithotripsy")); await f.flush();
    f.requests[0].resolve(Response.json({ template: invalid })); await f.flush();
    assert.equal(consumer.value.data, undefined); assert.ok(consumer.value.error); f.dispose();
  }
  console.log("Published templates / real SWR: type reuse, navigation, dirty/version pinning, refresh failure, rapid switches, schema-only and draft rejection PASS (mocked React host)");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
