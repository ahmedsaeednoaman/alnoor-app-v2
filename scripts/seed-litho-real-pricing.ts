import { postgresClient } from "@/db/client";
import { seedLithotripsyRealPricing } from "@/lib/accounting/lithotripsy-real-pricing-seed";

async function main() {
  const result = await postgresClient.begin((tx) => seedLithotripsyRealPricing(tx));
  console.log("Lithotripsy real pricing seed completed.");
  for (const session of result.sessions) console.log(`Session ${session.sessionNumber}: ${session.status}`);
  for (const profile of result.profiles) console.log(`Session ${profile.sessionNumber} / ${profile.name}: ${profile.status}; ${profile.requiresOwnerConfirmation ? "Owner price confirmation required" : `reference total ${profile.total} EGP`}`);
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => postgresClient.end({ timeout: 1 }));
