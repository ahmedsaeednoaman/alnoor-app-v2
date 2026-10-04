import assert from "node:assert/strict";
import { cacheRuntime, nodes } from "./cache-test-runtime";
import type { OperationManagementActions } from "../src/components/operations/operation-management-actions";

async function main() {
  const r = await cacheRuntime(); await r.activate();
  const Component = r.api.OperationManagementActions as unknown as typeof OperationManagementActions;
  const changed: string[] = [], errors: string[] = [];
  const props = { id: "synthetic", archived: false, status: "recorded", canArchive: true, canCancel: true,
    onChanged: (action: string) => changed.push(action), onError: (error: string) => errors.push(error) };
  const ui = r.mount(() => Component(props)); await r.flush();
  const action = (label: string) => (node: ReturnType<typeof nodes>[number]) => node.type === "button" && node.props.children === label;
  assert.ok(nodes(ui.value).some(action("أرشفة"))); assert.ok(nodes(ui.value).some(action("إلغاء")));
  r.setPrompt(""); await r.invoke(ui, action("أرشفة"));
  assert.equal(r.requests.length, 1); assert.equal(r.requests[0].url, "/api/v1/operations/synthetic/archive");
  assert.equal(r.requests[0].method, "POST"); assert.deepEqual(JSON.parse(r.requests[0].body!), { reason: "" });
  await r.invoke(ui, action("أرشفة")); assert.equal(r.requests.length, 1, "busy prevents duplicate mutations");
  r.requests[0].resolve(Response.json({ ok: true })); await r.flush(); assert.deepEqual(changed, ["archive"]);
  props.archived = true; ui.dirty = true; await r.flush();
  assert.equal(nodes(ui.value).some(action("إلغاء")), false);
  await r.invoke(ui, action("استعادة من الأرشيف")); r.requests[1].resolve(Response.json({ ok: true })); await r.flush();
  assert.deepEqual(changed, ["archive", "restore"]);
  props.archived = false; ui.dirty = true; await r.flush();
  await r.invoke(ui, action("إلغاء")); assert.equal(errors.length, 1); assert.equal(r.requests.length, 2, "reason required");
  r.setPrompt("سبب تجريبي"); await r.invoke(ui, action("إلغاء"));
  r.requests[2].resolve(Response.json({ error: { message: "blocked" } }, { status: 409 })); await r.flush();
  assert.equal(errors.at(-1), "blocked"); assert.equal(changed.length, 2);
  await r.invoke(ui, action("أرشفة")); await r.changeIdentity("other");
  r.requests[3].resolve(Response.json({ ok: true })); await r.flush(); assert.equal(changed.length, 2, "old account response ignored");
  r.unmount(ui);
  for (const [canArchive, canCancel] of [[false, false], [false, true]]) {
    const other = r.mount(() => Component({ ...props, canArchive, canCancel })); await r.flush();
    assert.equal(nodes(other.value).some(action("أرشفة")), false);
    assert.equal(nodes(other.value).some(action("إلغاء")), canCancel); r.unmount(other);
  }
  r.dispose(); console.log("Operation management UI: PASS (capabilities, archive/restore, reason, blockers, busy and stale responses)");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
