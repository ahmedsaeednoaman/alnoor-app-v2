import assert from "node:assert/strict";
import { beginRequest, failRequest, settleRequest, type LoadingState } from "@/lib/ui/loading-state";

const initial: LoadingState<string[]> = { loading: false, data: null, error: null, requestId: 0 };
const pending = beginRequest(initial, 1);
assert.equal(pending.loading, true);
assert.deepEqual(settleRequest(pending, 1, []), { loading: false, data: [], error: null, requestId: 1 });
assert.deepEqual(failRequest(pending, 1, "تعذر تحميل البيانات"), { loading: false, data: null, error: "تعذر تحميل البيانات", requestId: 1 });
assert.deepEqual(settleRequest(pending, 0, ["stale"]), pending);
const retry = beginRequest(failRequest(pending, 1, "خطأ"), 2);
assert.equal(retry.loading, true);
assert.deepEqual(settleRequest(retry, 2, ["ok"]), { loading: false, data: ["ok"], error: null, requestId: 2 });
console.log("UI loading lifecycle checks passed (success, empty, error, stale, retry)");
