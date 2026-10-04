import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";

// Execute the installed framework function, without patching node_modules or
// installing a global browser Performance wrapper. This is not a browser test.
for (const bundler of ["webpack", "turbopack"]) {
  const base = `node_modules/next/dist/compiled/react-server-dom-${bundler}/cjs/react-server-dom-${bundler}-client.browser`;
  const source = readFileSync(`${base}.development.js`, "utf8");
  const begin = source.indexOf("    function flushComponentPerformance(");
  const end = source.indexOf("    function flushInitialRenderPerformance(", begin);
  assert.ok(begin >= 0 && end > begin);
  for (const aborted of [false, true]) {
    const measurements: Array<{ name: string; start: number; end: number }> = [];
    const context = vm.createContext({
      isArrayImpl: Array.isArray, supportsUserTiming: true, trackNames: ["Server"],
      performance: {
        measure(name: string, options: { start: number; end: number }) {
          measurements.push({ name, ...options });
          return performance.measure(name, options);
        }, clearMeasures: (name: string) => performance.clearMeasures(name),
      },
      response: { _rootEnvironmentName: "Server", _closedReason: null },
      root: { _children: [], _debugInfo: [{ time: -20 }, { name: "Page" }, ...(aborted ? [] : [{ time: -10 }])], status: aborted ? "pending" : "rejected", reason: new Error("NEXT_REDIRECT") },
    });
    vm.runInContext(source.slice(begin, end), context);
    assert.throws(() => vm.runInContext("flushComponentPerformance(response, root, 0, -Infinity, -Infinity)", context), { code: "ERR_PERFORMANCE_INVALID_TIMESTAMP" });
    assert.equal(measurements[0].name, "\u200bPage");
    assert.equal(measurements[0].start, 0);
    assert.equal(measurements[0].end, aborted ? -20 : -10);
  }
  assert.equal(readFileSync(`${base}.production.js`, "utf8").includes("flushComponentPerformance"), false);
}
function checkApplication(path: string) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = `${path}/${entry.name}`;
    if (entry.isDirectory()) checkApplication(file);
    else if (/\.[jt]sx?$/.test(file)) assert.doesNotMatch(readFileSync(file, "utf8"), /performance\s*\.\s*measure\s*(?:\(|=)/, `${file}: no global workaround or app measurement`);
  }
}
checkApplication("src");
console.log("Installed RSC timing reproduction PASS: webpack AND Turbopack dev rejected/aborted Page measure start=0/end<0 throws; instrumentation absent in production client; no application measure workaround (VM, not browser navigation)");
