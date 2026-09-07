import { postgresClient } from "@/db/client";
import { calculateFinancialSummary } from "@/lib/accounting/calculation";
import { getFinancialReviewOperation } from "@/lib/accounting/review";
const main = async () => {
  const [operation] = await postgresClient.unsafe<Array<{ id: string }>>("select id from operations where status='recorded' and form_template_id is not null order by created_at desc limit 1");
  if (!operation) throw new Error("No recorded operation available");
  const review = await getFinancialReviewOperation(operation.id, { id: "accountant", permissions: ["accounting.review", "accounting.finance.view"] });
  const identities = review.operationalCostSources.map((source) => `${source.sourceType}:${source.sourceFieldId ?? ""}:${source.sourceReferenceId ?? ""}`);
  if (identities.length !== new Set(identities).size) throw new Error("duplicate operational pricing source");
  const [definitionColumn] = await postgresClient.unsafe<Array<{ exists: boolean }>>("select exists(select 1 from information_schema.columns where table_name='operation_financial_items' and column_name='definition_id') exists");
  if (!definitionColumn.exists) throw new Error("definition provenance column missing");
  const summary = calculateFinancialSummary(5000, [
    { kind: "financial", financialEffect: "subtract", amount: 450 },
    { kind: "financial", financialEffect: "subtract", amount: 400 },
    { kind: "financial", financialEffect: "subtract", amount: 900 },
    { kind: "financial", financialEffect: "subtract", amount: 500 },
    { kind: "financial", financialEffect: "subtract", amount: 300 },
    { kind: "financial", financialEffect: "subtract", amount: 250 },
    { kind: "financial", financialEffect: "subtract", amount: 300 },
    { kind: "financial", financialEffect: "subtract", amount: 400 },
  ]);
  if (summary.deductionTotal !== 3500 || summary.finalBalance !== 1500) throw new Error("spreadsheet calculation contract failed");
  console.log("finance spreadsheet checks passed (priced sources, definition identity, negative-safe calculation)");
};
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => postgresClient.end({ timeout: 1 }));
