import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const component = readFileSync(resolve("src/components/accounting/lithotripsy-pricing-profiles.tsx"), "utf8");
const workForm = readFileSync(resolve("src/components/operations/work-form-renderer.tsx"), "utf8");
const css = readFileSync(resolve("src/app/globals.css"), "utf8");

assert.match(component, /sessions\.filter\(item=>item\.active/, "The library must render data-driven session groups");
assert.match(component, /openNew\(session\)/, "Create must inherit its containing session");
assert.match(component, /setSessionNumber\(session\.sessionNumber\)/, "Session must be preselected for new price lists");
assert.match(component, /profile\.sessionId===session\.id/, "Active price lists must be grouped by stable session identity");
assert.match(component, /profiles\.filter\(\(profile\) => profile\.sessionNumber == null\)/, "Legacy null-session profiles must stay separate");
assert.match(component, /بنود قديمة \/ توافق تاريخي/, "Legacy profiles need an explicit Arabic label");
assert.match(component, /showArchived/, "Archived templates must be collapsible and secondary");
assert.match(component, /<MoneyInput/, "Template prices must use the canonical MoneyInput");
assert.doesNotMatch(component, /function MoneyInput\(/, "The pricing page must not duplicate MoneyInput");
assert.doesNotMatch(component, /<option value="session_cost"/, "New lines must not offer session_cost");
assert.match(component, /هذا بند مالي قديم محفوظ للتوافق/, "Legacy session-cost rows must remain readable");
assert.match(component, /الجلسة ليست بند تكلفة/, "The editor must explain that session is not a cost line");
assert.match(component, /pricing-session-landing/, "The pricing home must begin with a dedicated session landing");
assert.match(component, /pricing-session-overview-card/, "Sessions must render as large overview cards");
assert.match(component, /فتح الجلسة/, "Session cards must expose an explicit open action");
assert.match(component, /كل جلسات التفتيت/, "The session workspace must provide hierarchy navigation back home");
assert.match(component, /procedureOptionLabel/, "Procedure option labels must derive from stored procedures");
assert.doesNotMatch(component, /pricing-profile-card__preview/, "Procedure-option cards must not expose financial items before opening the option");
assert.match(component, /بنود قديمة \/ توافق تاريخي/, "Legacy configuration must be secondary and explicit");
assert.match(css, /\.pricing-session-overview-grid/, "Desktop library must expose the session-card grid");
assert.match(css, /\.pricing-session-library\{grid-template-columns:minmax\(0,1fr\)\}/, "The selected session must own one price-list workspace");
assert.match(css, /\.pricing-profile-line-editor__fields \.money-field\{width:100%\}/, "MoneyInput must fit the template line editor");
assert.match(workForm, /dynamic-field--pricing-session/, "Add Work must visibly identify the authoritative session step");
assert.match(workForm, /dynamic-field--pricing-procedures/, "Add Work must visibly identify the exact procedure-set step");
assert.match(workForm, /الجلسة مع هذه المجموعة تحدد قائمة الأسعار المطابقة/, "Add Work must explain session + procedure matching without exposing pricing controls");
assert.match(css, /\.dynamic-field--pricing-session\{order:-2\}/, "Session selection must precede procedures inside the operational section");
assert.match(css, /\.dynamic-field--pricing-procedures\{order:-1\}/, "Procedure selection must immediately follow the session");

console.log("Lithotripsy pricing library UI checks passed");
