import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { postgresClient } from "@/db/client";
import { saveFinancialReviewInTransaction } from "@/lib/accounting/review";
import { calculateDirectItemsDue, calculateDirectPaymentSummary, calculateSimpleReviewTotals } from "@/lib/accounting/simple-review";
import { financialReviewSchema } from "@/lib/operations/validation";

const rollback = Symbol("rollback");
const line = (description: string, amount: number, financialEffect: "add" | "subtract" | "neutral" = "subtract", caseLineState: "included" | "excluded" = "included") => ({ kind: "financial" as const, description, amount: String(amount), baseAmount: String(amount), adjustmentAmount: "0", effectiveAmount: String(amount), caseLineState, financialEffect, sourceType: "manual" as const, sourceFieldId: null, sourceReferenceId: null, notes: null });

async function main() {
  const items = [line("تخدير", 400), line("فني", 450), line("قسطرة", 1000), line("جهاز", 1150), line("مستلزمات", 200)];
  assert.equal(calculateDirectItemsDue(items), 3200);
  assert.deepEqual(calculateDirectPaymentSummary(3200, 3200), { due: 3200, received: 3200, remaining: 0, state: "paid" });
  assert.deepEqual(calculateDirectPaymentSummary(3200, 2000), { due: 3200, received: 2000, remaining: 1200, state: "partial" });
  assert.deepEqual(calculateDirectPaymentSummary(3200, 0), { due: 3200, received: 0, remaining: 3200, state: "unpaid" });
  assert.deepEqual(calculateDirectPaymentSummary(3200, null), { due: 3200, received: null, remaining: 3200, state: "unpaid" });
  assert.equal(calculateDirectItemsDue([line("خصم / تكلفة", 100), line("إضافة", 50, "add"), line("محايد", 999, "neutral")]), 150);
  assert.equal(calculateDirectItemsDue([line("مستبعد", 500, "subtract", "excluded"), line("نشط", 100)]), 100);
  assert.equal(calculateSimpleReviewTotals(1000, [line("تكلفة", 200)]).finalBalance, 800, "historical Main Amount semantics stay unchanged");

  try {
    await postgresClient.begin(async (tx) => {
      const [user] = await tx.unsafe<Array<{ id: string }>>("select id from users where username='tests' and archived_at is null");
      const [template] = await tx.unsafe<Array<{ id: string }>>("select id from work_form_templates where operation_type='lithotripsy' and status='published' order by version desc limit 1");
      assert.ok(user && template);
      const [sequence] = await tx.unsafe<Array<{ value: number }>>("select coalesce(max(daily_sequence),0)+1 value from operations where operation_date=current_date");
      const [operation] = await tx.unsafe<Array<{ id: string }>>(`insert into operations(type,operation_date,daily_sequence,operation_time,case_name,session_count,form_template_id,created_by_user_id,updated_by_user_id) values('lithotripsy',current_date,$1,'10:00','TEST-B24C-DIRECT-PAYMENT',1,$2::uuid,$3::uuid,$3::uuid) returning id`, [sequence.value, template.id, user.id]);
      const auth = { id: user.id, permissions: ["accounting.review", "accounting.finance.view", "accounting.finance.edit"] };
      const parsed = financialReviewSchema.parse({ expectedUpdatedAt: null, accountingMode: "direct_items", mainAmount: null, doctorReceivedAmount: "3200", notes: "اختبار مباشر", items });
      await saveFinancialReviewInTransaction(tx, operation.id, parsed, auth);
      const [saved] = await tx.unsafe<Array<{ accounting_mode: string; main_amount: string; doctor_account_amount: string; doctor_received_amount: string; status: string; notes: string }>>("select accounting_mode,main_amount,doctor_account_amount,doctor_received_amount,status,notes from operation_financial_reviews where operation_id=$1::uuid", [operation.id]);
      assert.equal(saved.accounting_mode, "direct_items");
      assert.equal(Number(saved.main_amount), 0, "Direct mode must not fake a Main Amount");
      assert.equal(Number(saved.doctor_account_amount), 3200);
      assert.equal(Number(saved.doctor_received_amount), 3200);
      assert.equal(saved.status, "paid");
      assert.equal(saved.notes, "اختبار مباشر");

      const [review] = await tx.unsafe<Array<{ id: string; updated_at: Date }>>("select id,updated_at from operation_financial_reviews where operation_id=$1::uuid", [operation.id]);
      const partial = financialReviewSchema.parse({ ...parsed, expectedUpdatedAt: new Date(review.updated_at).toISOString(), doctorReceivedAmount: "2000" });
      await saveFinancialReviewInTransaction(tx, operation.id, partial, auth);
      const [partialSaved] = await tx.unsafe<Array<{ doctor_account_amount: string; doctor_received_amount: string; status: string }>>("select doctor_account_amount,doctor_received_amount,status from operation_financial_reviews where id=$1::uuid", [review.id]);
      assert.equal(Number(partialSaved.doctor_account_amount) - Number(partialSaved.doctor_received_amount), 1200);
      assert.equal(partialSaved.status, "partially_paid");

      const [latest] = await tx.unsafe<Array<{ updated_at: Date }>>("select updated_at from operation_financial_reviews where id=$1::uuid", [review.id]);
      const forged = { ...parsed, expectedUpdatedAt: new Date(latest.updated_at).toISOString(), doctorReceivedAmount: "3200", items: parsed.items.map((item, index) => index === 0 ? { ...item, effectiveAmount: "999999" } : item) };
      await saveFinancialReviewInTransaction(tx, operation.id, forged, auth);
      const [authoritative] = await tx.unsafe<Array<{ doctor_account_amount: string }>>("select doctor_account_amount from operation_financial_reviews where id=$1::uuid", [review.id]);
      assert.equal(Number(authoritative.doctor_account_amount), 3200, "server must ignore forged effective totals and recalculate from base plus adjustment");

      const legacy = await tx.unsafe<Array<{ accounting_mode: string; doctor_received_amount: string | null }>>("select accounting_mode,doctor_received_amount from operation_financial_reviews where operation_id<>$1::uuid order by created_at limit 1", [operation.id]);
      assert.ok(legacy.every((row) => row.accounting_mode === "main_amount" && row.doctor_received_amount == null), "existing reviews must remain legacy Main Amount snapshots");
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  const route = readFileSync("src/app/api/v1/operations/[operationId]/financial-review/route.ts", "utf8");
  assert.match(route, /accounting\.finance\.edit/);
  assert.match(route, /accounting\.review/);
  console.log("Lithotripsy direct doctor payment checks passed with transaction rollback");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => postgresClient.end({ timeout: 1 }));
