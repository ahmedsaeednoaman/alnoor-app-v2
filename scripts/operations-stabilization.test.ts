import { postgresClient } from "../src/db/client";
import { getDraftTemplate, getPublishedTemplate } from "../src/lib/work-forms/service";
import { signedItemTotal } from "../src/lib/accounting/review";
import { resolveSmartDropdownSource } from "../src/lib/work-forms/registry";

const expect = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

async function main() {
  const published = await getPublishedTemplate("lithotripsy");
  expect(String(published.updatedAt).endsWith("Z"), "template timestamps must be ISO for mutation concurrency");
  const draft = await getDraftTemplate("lithotripsy");
  expect(String(draft.updatedAt).endsWith("Z"), "draft timestamps must be ISO for mutation concurrency");
  expect(resolveSmartDropdownSource("anesthesia_types").table === "anesthesia_types", "anesthesia source must be registered");
  expect(signedItemTotal([
    { kind: "financial", financialEffect: "add", amount: "100.00" },
    { kind: "financial", financialEffect: "subtract", amount: "250.00" },
    { kind: "financial", financialEffect: "neutral", amount: "999.00" },
  ]) === -150, "financial effects must use add/subtract/neutral semantics");
  const [columns] = await postgresClient.unsafe<Array<{ doctor_balance_received: boolean }>>(
    "select doctor_balance_received from operation_financial_reviews limit 1",
  );
  expect(columns === undefined || typeof columns.doctor_balance_received === "boolean", "doctor received state must exist");
  console.log("operations stabilization regression checks passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => postgresClient.end({ timeout: 1 }));
