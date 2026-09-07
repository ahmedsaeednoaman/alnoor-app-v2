import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeMoneyInput } from "@/components/operations/money-input";

assert.equal(normalizeMoneyInput(""), "", "blank stays blank");
assert.equal(normalizeMoneyInput("0"), "0", "explicit zero stays zero");
assert.equal(normalizeMoneyInput("400"), "400", "450 can be replaced with 400 without formatting interference");
assert.equal(normalizeMoneyInput("650"), "650", "450 can be replaced with 650 without formatting interference");
assert.equal(normalizeMoneyInput("999999.99"), "999999.99", "large decimal currency remains intact");
assert.equal(normalizeMoneyInput("1,250"), "1250", "pasted thousands separators normalize safely");
assert.equal(normalizeMoneyInput("10.005"), "10.00", "currency precision remains two decimals");
assert.equal(normalizeMoneyInput("abc"), "", "invalid text never becomes NaN");
assert.notEqual(normalizeMoneyInput(""), normalizeMoneyInput("0"), "empty and explicit zero remain distinct");

const source = readFileSync("src/components/operations/money-input.tsx", "utf8");
assert.match(source, /type="text"/, "currency input does not use native number spinners");
assert.match(source, /inputMode="decimal"/, "mobile numeric keyboard is requested");
assert.match(source, /onWheel=.*blur/, "focused mouse wheel cannot alter the value");
assert.match(source, /money-field__currency/, "currency suffix is structurally separated from the input");
assert.match(source, /aria-label=/, "financial input supports an accessible name");

console.log("Money input UX checks passed (blank/zero, replacement, decimals, large values, keyboard and wheel safety)");
