import { postgresClient } from "@/db/client";
import { getOperationFinancialSources } from "@/lib/accounting/sources";
import { calculateFinancialSummary } from "@/lib/accounting/calculation";
import { getFinancialReviewOperation } from "@/lib/accounting/review";

async function main() {
const [operation] = await postgresClient.unsafe<Array<Record<string, unknown>>>(
  "select id,form_template_id from operations where status='recorded' and form_template_id is not null order by created_at desc limit 1",
);
if (!operation) throw new Error("No recorded operation available for foundation checks");
const id = String(operation.id);
const sourceContract = await getOperationFinancialSources(id);
if (sourceContract.costSources.some((source) => !source.sourceFieldId || !source.label)) throw new Error("cost source provenance missing");

const selected = await postgresClient.unsafe<Array<{ id: string }>>("select equipment_id id from operation_equipment where operation_id=$1::uuid", [id]);
const equipmentSources = sourceContract.costSources.filter((source) => source.sourceType === "equipment");
if (selected.length && equipmentSources.some((source) => !selected.some((row) => row.id === source.sourceReferenceId))) throw new Error("global catalog item leaked into sources");
if (equipmentSources.length !== new Set(equipmentSources.map((source) => source.sourceReferenceId)).size) throw new Error("multi-source expansion duplicated equipment identity");

const [review] = await postgresClient.unsafe<Array<Record<string, unknown>>>("select id from operation_financial_reviews where operation_id=$1::uuid", [id]);
if (review) {
  const items = await postgresClient.unsafe<Array<Record<string, unknown>>>("select source_type,source_field_id,source_reference_id from operation_financial_items where review_id=$1::uuid and source_type not in ('manual','other')", [String(review.id)]);
  const identities = new Set(items.map((item) => `${item.source_type}:${item.source_field_id ?? ""}:${item.source_reference_id ?? ""}`));
  if (identities.size !== items.length) throw new Error("duplicate persisted financial provenance");
}

const contextKeys = new Set(sourceContract.context.map((item) => item.stableKey));
for (const key of ["doctor", "hospital", "anesthesia_type", "session_count"]) if (contextKeys.has(key)) continue;
const summaryA = calculateFinancialSummary(10000, [{ kind: "financial", financialEffect: "subtract", amount: 9000 }]);
const summaryB = calculateFinancialSummary(5000, [{ kind: "financial", financialEffect: "subtract", amount: 9000 }]);
const summaryC = calculateFinancialSummary(10000, [{ kind: "financial", financialEffect: "add", amount: 500 }, { kind: "financial", financialEffect: "subtract", amount: 9000 }]);
if (summaryA.finalBalance !== 1000 || summaryB.finalBalance !== -4000 || summaryC.finalBalance !== 1500) throw new Error("authoritative calculation contract failed");
let denied = false;
try { await getFinancialReviewOperation(id, { id: "employee", permissions: ["operations.view"] }); } catch (error) { denied = (error as { status?: number }).status === 403; }
if (!denied) throw new Error("employee financial privacy check failed");
console.log("finance rebuild foundation checks passed (operation-driven sources, provenance, calculation, privacy)");
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await postgresClient.end({ timeout: 1 }); });
