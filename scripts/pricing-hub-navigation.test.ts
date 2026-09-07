import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { getAllowedNavigation } from "../src/lib/navigation";

const pricingPermissions = [
  "accounting.lithotripsy.pricing.manage",
  "accounting.contract.pricing.manage",
  "accounting.endoscopy.pricing.manage",
];
const ownerNavigation = getAllowedNavigation(["*"], pricingPermissions);
const ownerItems = ownerNavigation.flatMap((section) => section.items);
assert.equal(ownerItems.filter((item) => item.href === "/accounts/pricing").length, 1);
assert.equal(ownerItems.some((item) => item.label === "بنود وأسعار"), true);
assert.equal(ownerItems.some((item) => item.label === "أسعار التفتيت"), false);

for (const permission of pricingPermissions) {
  const items = getAllowedNavigation(["accounting"], [permission]).flatMap((section) => section.items);
  assert.equal(items.some((item) => item.href === "/accounts/pricing"), true, `${permission} exposes the one authorized pricing entry`);
}
const employeeItems = getAllowedNavigation(["operations"], ["operations.view", "operations.create"]).flatMap((section) => section.items);
assert.equal(employeeItems.some((item) => item.href === "/accounts/pricing"), false);

const hub = readFileSync("src/app/(shell)/accounts/pricing/page.tsx", "utf8");
assert.match(hub, /accounting\.lithotripsy\.pricing\.manage/);
assert.match(hub, /accounting\.contract\.pricing\.manage/);
assert.match(hub, /accounting\.endoscopy\.pricing\.manage/);
assert.match(hub, /\/accounts\/review\/lithotripsy\/pricing/);
assert.match(hub, /\/accounts\/review\/contract\/pricing/);
assert.match(hub, /\/accounts\/review\/endoscopy\/pricing/);

for (const route of ["lithotripsy", "contract", "endoscopy"]) {
  const page = readFileSync(`src/app/(shell)/accounts/review/${route}/pricing/page.tsx`, "utf8");
  assert.match(page, new RegExp(`accounting\\.${route}\\.pricing\\.manage`));
}

const lithotripsy = readFileSync("src/components/accounting/lithotripsy-pricing-profiles.tsx", "utf8");
const services = readFileSync("src/components/accounting/service-pricing-library.tsx", "utf8");
assert.match(lithotripsy, /href="\/accounts\/pricing"/);
assert.match(services, /href="\/accounts\/pricing"/);

console.log("Unified pricing hub navigation and RBAC checks passed");
