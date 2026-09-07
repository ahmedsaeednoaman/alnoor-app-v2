import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getAllowedNavigation } from "../src/lib/navigation";

const root = process.cwd();
const routeFiles = new Map([
  ["/", "src/app/(shell)/page.tsx"],
  ["/operations/new", "src/app/(shell)/operations/new/page.tsx"],
  ["/operations", "src/app/(shell)/operations/page.tsx"],
  ["/accounts/review", "src/app/(shell)/accounts/review/page.tsx"],
  ["/accounts/review/lithotripsy/pricing", "src/app/(shell)/accounts/review/lithotripsy/pricing/page.tsx"],
  ["/print", "src/app/(shell)/print/page.tsx"],
  ["/reports", "src/app/(shell)/reports/page.tsx"],
  ["/settings", "src/app/(shell)/settings/page.tsx"],
]);

for (const [route, file] of routeFiles) {
  assert.ok(existsSync(resolve(root, file)), `Navigation route ${route} must exist`);
}

const employee = getAllowedNavigation(["dashboard", "operations"], ["dashboard.view", "operations.create", "operations.view"])
  .flatMap((section) => section.items.map((item) => item.href));
assert.ok(employee.includes("/operations") && employee.includes("/operations/new"));
assert.ok(!employee.some((href) => href.startsWith("/accounts")), "Employee navigation must not expose accounting");
assert.ok(!employee.includes("/settings"), "Employee navigation must not expose settings");

const accountant = getAllowedNavigation(["dashboard", "operations", "accounting", "printing", "reports"], [
  "dashboard.view", "operations.view", "accounting.review", "accounting.finance.view", "printing.use", "reports.view",
]).flatMap((section) => section.items.map((item) => item.href));
assert.ok(accountant.includes("/accounts/review"));
assert.ok(accountant.includes("/accounts/review/lithotripsy/pricing"));
assert.ok(!accountant.includes("/operations/new"), "Navigation must honor missing operation-create permission");

const workbench = readFileSync(resolve(root, "src/components/accounting/financial-review-workbench.tsx"), "utf8");
assert.match(workbench, /href="\/accounts\/review\/lithotripsy\/pricing"/, "Review must link to the canonical pricing library");
assert.doesNotMatch(workbench, /LithotripsyPricingManager|pricingOpen/, "The legacy embedded pricing manager must not remain visible");

for (const asset of ["file.svg", "globe.svg", "next.svg", "vercel.svg", "window.svg"]) {
  assert.ok(!existsSync(resolve(root, "public", asset)), `Unused Next starter asset ${asset} must be removed`);
}

console.log("Project cleanup route, navigation, RBAC, canonical UI, and asset checks passed");
