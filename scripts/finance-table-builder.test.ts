import { postgresClient } from "@/db/client";
import { ensureFinancialReviewLayout, getFinancialReviewLayout, getOperationFieldSources, mutateFinancialReviewLayout } from "@/lib/accounting/layout";
async function main() {
  const [user] = await postgresClient.unsafe<Array<{ id: string }>>("select id from users order by created_at limit 1");
  if (!user) throw new Error("No user available for layout bootstrap");
  const litho = await ensureFinancialReviewLayout("lithotripsy", user.id);
  const endoscopy = await ensureFinancialReviewLayout("endoscopy", user.id);
  const contract = await ensureFinancialReviewLayout("contract", user.id);
  if (!litho.some((column) => column.stableKey === "anesthesia_type") || !litho.some((column) => column.stableKey === "final_balance")) throw new Error("Lithotripsy defaults missing");
  if (endoscopy.some((column) => column.stableKey === "anesthesia_type") || contract.some((column) => column.stableKey === "session_count")) throw new Error("operation-type layouts leaked");
  const fields = await getOperationFieldSources("lithotripsy");
  if (!fields.some((field) => field.stableKey === "anesthesia_type")) throw new Error("same-type operation field source missing");
  const stored = await getFinancialReviewLayout("lithotripsy");
  if (stored.length !== litho.length || stored.some((column, index) => column.sortOrder !== index)) throw new Error("layout order is not persisted");
  if (stored.some((column) => !["small", "medium", "large"].includes(column.width))) throw new Error("invalid persisted width");
  const key = `test_table_column_${Date.now()}`;
  const added = await mutateFinancialReviewLayout("lithotripsy", "add", { stableKey: key, label: "تمريض وعمال اختبار", kind: "accountant_input", effect: "subtract", width: "large" }, user.id);
  const created = added.find((column) => column.stableKey === key); if (!created || created.effect !== "subtract") throw new Error("accountant input column was not persisted");
  await mutateFinancialReviewLayout("lithotripsy", "update", { id: created.id, label: "أجر عمال اختبار", width: "small" }, user.id);
  await mutateFinancialReviewLayout("lithotripsy", "visibility", { id: created.id, visible: false }, user.id);
  await mutateFinancialReviewLayout("lithotripsy", "archive", { id: created.id }, user.id);
  const cleaned = await getFinancialReviewLayout("lithotripsy"); if (cleaned.some((column) => column.stableKey === key)) throw new Error("disposable layout column was not archived");
  console.log("finance table builder checks passed (independent defaults, source scope, persistence)");
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => postgresClient.end({ timeout: 1 }));
