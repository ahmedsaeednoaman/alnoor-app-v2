import assert from "node:assert/strict";
import { postgresClient } from "@/db/client";
import { LITHOTRIPSY_REAL_PRICING_PLAN, planTotal, seedLithotripsyRealPricing } from "@/lib/accounting/lithotripsy-real-pricing-seed";
import { resolveSourcePrice } from "@/lib/accounting/lithotripsy-source-pricing";

const rollback = Symbol("rollback");

async function main() {
  assert.equal(planTotal(LITHOTRIPSY_REAL_PRICING_PLAN[0]), 3200, "تفتيت فقط must total 3200 EGP");
  assert.equal(planTotal(LITHOTRIPSY_REAL_PRICING_PLAN[1]), 4750, "تفتيت + تركيب must total 4750 EGP");
  assert.ok(LITHOTRIPSY_REAL_PRICING_PLAN.every((plan) => plan.lines.every((line) => line.lineType !== ("session_cost" as never))), "session must never be seeded as a cost-line type");
  assert.equal(LITHOTRIPSY_REAL_PRICING_PLAN.filter((plan) => plan.sessionNumber === 2).every((plan) => plan.lines.length === 0 && plan.requiresOwnerConfirmation), true, "uncertain Session 2 prices must remain unseeded");
  const generic = { id: "generic", lineType: "linked_role", sourceType: "technician", sourceReferenceId: null, defaultAmount: 450 } as const;
  const specific = { id: "specific", lineType: "linked_source", sourceType: "technician", sourceReferenceId: "11111111-1111-4111-8111-111111111111", defaultAmount: 700 } as const;
  assert.equal(resolveSourcePrice({ profileLines: [generic, specific], sourceType: "technician", sourceReferenceId: specific.sourceReferenceId }).resolvedAmount, 700);
  assert.equal(resolveSourcePrice({ profileLines: [generic], sourceType: "technician", sourceReferenceId: specific.sourceReferenceId }).resolvedAmount, 450);
  assert.equal(resolveSourcePrice({ profileLines: [], sourceType: "consumable", sourceReferenceId: specific.sourceReferenceId }).resolvedAmount, null);

  try {
    await postgresClient.begin(async (tx) => {
      const [historyBefore] = await tx.unsafe<Array<{ operations: number; reviews: number; items: number }>>(`select
        (select count(*)::int from operations where case_name not like 'TEST-%') operations,
        (select count(*)::int from operation_financial_reviews r join operations o on o.id=r.operation_id where o.case_name not like 'TEST-%') reviews,
        (select count(*)::int from operation_financial_items i join operation_financial_reviews r on r.id=i.review_id join operations o on o.id=r.operation_id where o.case_name not like 'TEST-%') items`);
      const first = await seedLithotripsyRealPricing(tx);
      const second = await seedLithotripsyRealPricing(tx);
      assert.equal(second.profiles.every((profile) => profile.status === "preserved"), true, "second seed must preserve every profile");
      assert.deepEqual(second.profiles.map((profile) => profile.id), first.profiles.map((profile) => profile.id), "idempotent seed must preserve profile identities");
      for (const [index, profile] of first.profiles.entries()) {
        const [row] = await tx.unsafe<Array<{ procedures: number; lines: number; duplicate_keys: number }>>(`select
          (select count(*)::int from lithotripsy_pricing_profile_procedures where profile_id=$1::uuid) procedures,
          (select count(*)::int from lithotripsy_pricing_profile_lines where profile_id=$1::uuid) lines,
          (select count(*)::int-count(distinct stable_key)::int from lithotripsy_pricing_profile_lines where profile_id=$1::uuid) duplicate_keys`, [profile.id]);
        assert.equal(row.procedures, 1);
        assert.equal(row.lines, LITHOTRIPSY_REAL_PRICING_PLAN[index].lines.length, "seeded option must contain exactly its planned pricing lines");
        assert.equal(row.duplicate_keys, 0);
      }
      const [historyAfter] = await tx.unsafe<Array<{ operations: number; reviews: number; items: number }>>(`select
        (select count(*)::int from operations where case_name not like 'TEST-%') operations,
        (select count(*)::int from operation_financial_reviews r join operations o on o.id=r.operation_id where o.case_name not like 'TEST-%') reviews,
        (select count(*)::int from operation_financial_items i join operation_financial_reviews r on r.id=i.review_id join operations o on o.id=r.operation_id where o.case_name not like 'TEST-%') items`);
      assert.deepEqual(historyAfter, historyBefore, "seed must not mutate historical operation finance");
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  console.log("Lithotripsy real pricing seed checks passed with transaction rollback");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => postgresClient.end({ timeout: 1 }));
