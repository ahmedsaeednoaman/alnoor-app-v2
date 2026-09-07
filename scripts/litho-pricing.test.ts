import { postgresClient } from "@/db/client";
import { listLithotripsyPricing, resolveLithotripsyReviewDefaults } from "@/lib/accounting/lithotripsy-pricing";

async function main() {
  const definitions = await listLithotripsyPricing();
  const find = (key: string) => definitions.find((item) => item.stableKey === key);
  if (find("anesthesiologist_default")?.defaultAmount !== 450) throw new Error("anesthesiologist role default failed");
  if (find("technician_default")?.defaultAmount !== 400) throw new Error("technician role default failed");
  if (find("session_expenses_first")?.defaultAmount !== 500 || find("session_expenses_second")?.defaultAmount !== 300) throw new Error("session defaults failed");
  if (find("nursing_workers")?.defaultAmount !== 200) throw new Error("fixed nursing default failed");
  const [operation] = await postgresClient.unsafe<Array<{ id: string }>>("select id from operations where type='lithotripsy' and status='recorded' order by created_at desc limit 1");
  if (operation) {
    const resolved = await resolveLithotripsyReviewDefaults(operation.id);
    if (resolved.some((item) => item.defaultAmount != null && item.pricingOrigin === "none")) throw new Error("unresolved pricing origin");
    if (resolved.filter((item) => item.stableKey.startsWith("session_expenses_")).length > 1) throw new Error("both legacy session defaults resolved");
  }
  console.log("lithotripsy pricing checks passed (legacy definitions preserved, resolver safety)");
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => postgresClient.end({ timeout: 1 }));
