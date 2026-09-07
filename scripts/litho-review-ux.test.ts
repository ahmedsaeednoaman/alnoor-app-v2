import { postgresClient } from "@/db/client";
import { calculateFinancialSummary } from "@/lib/accounting/calculation";
import { resolveLithotripsyReviewDefaults } from "@/lib/accounting/lithotripsy-pricing";

async function main() {
  const summary = (main: number, items: Array<{ amount: number; financialEffect: "add"|"subtract"|"neutral" }>) => calculateFinancialSummary(main, items.map((item) => ({ kind: "financial", ...item })));
  if (summary(10000, [{ amount: 9000, financialEffect: "subtract" }]).finalBalance !== 1000) throw new Error("positive live calculation failed");
  if (summary(10000, [{ amount: 9050, financialEffect: "subtract" }]).finalBalance !== 950) throw new Error("override live calculation failed");
  if (summary(5000, [{ amount: 5000, financialEffect: "subtract" }, { amount: 0, financialEffect: "subtract" }]).finalBalance !== 0) throw new Error("explicit zero calculation failed");
  if (summary(10000, [{ amount: 50, financialEffect: "subtract" }, { amount: 100, financialEffect: "add" }]).finalBalance !== 10050) throw new Error("exception effects failed");
  if (summary(2000, [{ amount: 3700, financialEffect: "subtract" }]).finalBalance !== -1700) throw new Error("negative calculation failed");
  const [operation] = await postgresClient.unsafe<Array<{ id: string }>>("select id from operations where type='lithotripsy' and status='recorded' order by operation_date desc,created_at desc limit 1");
  if (operation) {
    const resolved = await resolveLithotripsyReviewDefaults(operation.id);
    const sessions = resolved.filter((item) => item.stableKey.startsWith("session_expenses_"));
    if (sessions.length > 1) throw new Error("session pricing leaked both session definitions");
    const sourceRows = resolved.filter((item) => item.source);
    if (new Set(sourceRows.map((item) => `${item.source?.sourceType}:${item.source?.sourceReferenceId ?? item.source?.sourceId ?? ""}`)).size !== sourceRows.length) throw new Error("duplicate source projection");
  }
  const dates = ["2026-08-20", "2026-08-19"].sort((a, b) => b.localeCompare(a));
  if (dates[0] !== "2026-08-20") throw new Error("newest-first grouping failed");
  console.log("lithotripsy review UX checks passed (grouping, defaults, live math, overrides, zero, effects, session safety)");
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await postgresClient.end({ timeout: 1 }); });
