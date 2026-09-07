import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { postgresClient } from "@/db/client";
import { assertUniqueFinancialSources } from "@/lib/accounting/lithotripsy-profiles";
import { resolveLithotripsyReviewDefaults } from "@/lib/accounting/lithotripsy-pricing";
import { resolveSourcePrice } from "@/lib/accounting/lithotripsy-source-pricing";

const rollback = Symbol("rollback");
const generic = { id: "generic", lineType: "linked_role", sourceType: "technician", sourceReferenceId: null, defaultAmount: 450 } as const;
const specific = { id: "specific", lineType: "linked_source", sourceType: "technician", sourceReferenceId: "11111111-1111-4111-8111-111111111111", defaultAmount: 700 } as const;

async function main() {
  assert.deepEqual(resolveSourcePrice({ profileLines: [generic, specific], sourceType: "technician", sourceReferenceId: specific.sourceReferenceId }), { matchedLine: specific, resolvedAmount: 700, origin: "specific" });
  assert.deepEqual(resolveSourcePrice({ profileLines: [generic, specific], sourceType: "technician", sourceReferenceId: "22222222-2222-4222-8222-222222222222" }), { matchedLine: generic, resolvedAmount: 450, origin: "generic" });
  assert.deepEqual(resolveSourcePrice({ profileLines: [], sourceType: "technician", sourceReferenceId: specific.sourceReferenceId }), { matchedLine: null, resolvedAmount: null, origin: "none" });
  const zero = { ...specific, id: "zero", defaultAmount: 0 };
  assert.equal(resolveSourcePrice({ profileLines: [generic, zero], sourceType: "technician", sourceReferenceId: zero.sourceReferenceId }).resolvedAmount, 0, "explicit zero must not fall through");
  assert.equal(resolveSourcePrice({ profileLines: [{ ...specific, label: "اسم قديم" }], sourceType: "technician", sourceReferenceId: specific.sourceReferenceId }).origin, "specific", "display label is not identity");
  assert.doesNotThrow(() => assertUniqueFinancialSources([generic, specific]));
  assert.throws(() => assertUniqueFinancialSources([generic, generic]), /نفس المصدر المالي/);
  assert.throws(() => assertUniqueFinancialSources([specific, specific]), /نفس المصدر المالي/);
  assert.equal(resolveSourcePrice({ profileLines: [{ ...generic, lineType: "fixed_cost" }, { ...specific, lineType: "session_cost" }], sourceType: "technician", sourceReferenceId: specific.sourceReferenceId }).origin, "none", "fixed and legacy lines remain compatible but are not source rules");
  for (const sourceType of ["anesthesiologist", "equipment", "stent", "consumable"]) {
    const category = { ...generic, id: `${sourceType}-generic`, sourceType, defaultAmount: 300 };
    const item = { ...specific, id: `${sourceType}-specific`, sourceType, defaultAmount: 425 };
    assert.equal(resolveSourcePrice({ profileLines: [category, item], sourceType, sourceReferenceId: item.sourceReferenceId }).resolvedAmount, 425, `${sourceType} supports specific pricing`);
    assert.equal(resolveSourcePrice({ profileLines: [category, item], sourceType, sourceReferenceId: "33333333-3333-4333-8333-333333333333" }).resolvedAmount, 300, `${sourceType} supports category fallback`);
  }

  try {
    await postgresClient.begin(async (tx) => {
      const [user] = await tx.unsafe<Array<{ id: string }>>("select id from users where archived_at is null order by created_at limit 1");
      const [template] = await tx.unsafe<Array<{ id: string }>>("select id from work_form_templates where operation_type='lithotripsy' and status='published' order by version desc limit 1");
      const technicians = await tx.unsafe<Array<{ id: string }>>("select id from technicians where archived_at is null order by name limit 2");
      assert.ok(user && template && technicians.length >= 2, "published form and two technicians are required");
      const token = crypto.randomUUID().replaceAll("-", "");
      const [procedure] = await tx.unsafe<Array<{ id: string }>>("insert into procedures(name,normalized_name,category,created_by_user_id) values($1,$2,'اختبار',$3::uuid) returning id", [`TEST-B23B-PROC-${token}`, `test_b23b_proc_${token}`, user.id]);
      const equipment: Array<{ id: string }> = [];
      for (const index of ["A", "B"]) {
        const [item] = await tx.unsafe<Array<{ id: string }>>("insert into equipment(name,normalized_name,equipment_type,created_by_user_id) values($1,$2,(select equipment_type from equipment limit 1),$3::uuid) returning id", [`TEST-B23B-EQUIPMENT-${index}-${token}`, `test_b23b_equipment_${index.toLowerCase()}_${token}`, user.id]);
        equipment.push(item);
      }
      const [profile] = await tx.unsafe<Array<{ id: string }>>(`insert into lithotripsy_pricing_profiles(name,normalized_name,procedure_set_key,session_number,is_base,active,version,sort_order,created_by_user_id,updated_by_user_id)
        values($1,$2,$3,1,false,true,1,9900,$4::uuid,$4::uuid) returning id`, [`TEST-B23B-${token}`, `test_b23b_${token}`, procedure.id, user.id]);
      await tx.unsafe("insert into lithotripsy_pricing_profile_procedures(profile_id,procedure_id,sort_order) values($1::uuid,$2::uuid,0)", [profile.id, procedure.id]);
      const lines = [
        ["tech_generic", "linked_role", "الفني — افتراضي", 450, "technician", null],
        ["tech_specific", "linked_source", "الفني — مخصص", 700, "technician", technicians[0].id],
        ["equipment_generic", "linked_role", "الأجهزة — افتراضي", 200, "equipment", null],
        ["equipment_specific", "linked_source", "الأجهزة — مخصص", 350, "equipment", equipment[0].id],
        ["fixed_compatible", "fixed_cost", "بند ثابت", 25, null, null],
      ];
      for (const [sortOrder, line] of lines.entries()) await tx.unsafe(`insert into lithotripsy_pricing_profile_lines(profile_id,stable_key,line_type,label,default_amount,effect,source_type,source_reference_id,sort_order,active,created_by_user_id,updated_by_user_id)
        values($1::uuid,$2,$3,$4,$5,'subtract',$6,$7::uuid,$8,true,$9::uuid,$9::uuid)`, [profile.id, ...line, sortOrder, user.id]);

      async function operation(session: 1 | 2, technicianId: string, selectedEquipment: string[] = []) {
        const [sequence] = await tx.unsafe<Array<{ value: number }>>("select coalesce(max(daily_sequence),0)+1 value from operations where operation_date=current_date");
        const [op] = await tx.unsafe<Array<{ id: string }>>(`insert into operations(type,operation_date,daily_sequence,operation_time,case_name,session_count,technician_id,form_template_id,created_by_user_id,updated_by_user_id)
          values('lithotripsy',current_date,$1,'09:00',$2,$3,$4::uuid,$5::uuid,$6::uuid,$6::uuid) returning id`, [sequence.value, `TEST-B23B-OP-${token}`, session, technicianId, template.id, user.id]);
        await tx.unsafe("insert into operation_procedures(operation_id,procedure_id) values($1::uuid,$2::uuid)", [op.id, procedure.id]);
        for (const equipmentId of selectedEquipment) await tx.unsafe("insert into operation_equipment(operation_id,equipment_id) values($1::uuid,$2::uuid)", [op.id, equipmentId]);
        return op.id;
      }

      const specificOperation = await operation(1, technicians[0].id, equipment.map((item) => item.id));
      const resolved = await resolveLithotripsyReviewDefaults(specificOperation, tx);
      const tech = resolved.find((line) => line.source?.sourceType === "technician");
      assert.equal(tech?.defaultAmount, 700);
      assert.equal(tech?.pricingOrigin, "specific_source_default");
      const resolvedEquipment = resolved.filter((line) => line.source?.sourceType === "equipment");
      assert.deepEqual(resolvedEquipment.map((line) => [line.source?.sourceReferenceId, line.defaultAmount, line.pricingOrigin]).sort(), [[equipment[0].id, 350, "specific_source_default"], [equipment[1].id, 200, "profile_role_default"]].sort(), "multi-select sources resolve independently");
      const genericOperation = await operation(1, technicians[1].id);
      assert.equal((await resolveLithotripsyReviewDefaults(genericOperation, tx)).find((line) => line.source?.sourceType === "technician")?.defaultAmount, 450);

      await tx.unsafe("update operations set technician_id=$2::uuid where id=$1::uuid", [genericOperation, technicians[0].id]);
      assert.equal((await resolveLithotripsyReviewDefaults(genericOperation, tx)).find((line) => line.source?.sourceType === "technician")?.defaultAmount, 700, "fresh unsaved derivation follows the current operation source");
      const wrongSession = await operation(2, technicians[0].id);
      assert.notEqual((await resolveLithotripsyReviewDefaults(wrongSession, tx)).find((line) => line.source?.sourceType === "technician")?.defaultAmount, 700, "session/profile pricing must not leak");

      const [review] = await tx.unsafe<Array<{ id: string }>>("insert into operation_financial_reviews(operation_id,status,main_amount,doctor_account_amount,reviewed_by_user_id) values($1::uuid,'reviewed',1000,300,$2::uuid) returning id", [specificOperation, user.id]);
      const [snapshot] = await tx.unsafe<Array<{ id: string }>>(`insert into operation_financial_items(review_id,kind,description,amount,base_amount,adjustment_amount,effective_amount,financial_effect,source_type,source_reference_id,pricing_profile_id,pricing_profile_version,created_by_user_id)
        values($1::uuid,'financial','لقطة محفوظة',700,700,0,700,'subtract','technician',$2::uuid,$3::uuid,1,$4::uuid) returning id`, [review.id, technicians[0].id, profile.id, user.id]);
      await tx.unsafe("update lithotripsy_pricing_profile_lines set default_amount=725 where profile_id=$1::uuid and stable_key='tech_specific'", [profile.id]);
      const [saved] = await tx.unsafe<Array<{ effective_amount: string }>>("select effective_amount from operation_financial_items where id=$1::uuid", [snapshot.id]);
      assert.equal(Number(saved.effective_amount), 700, "saved historical financial item must remain unchanged");
      assert.equal((await resolveLithotripsyReviewDefaults(await operation(1, technicians[0].id), tx)).find((line) => line.source?.sourceType === "technician")?.defaultAmount, 725, "future fresh resolution uses the changed default");
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }

  const pricingRoute = readFileSync("src/app/api/v1/financial-reviews/pricing-profiles/lithotripsy/route.ts", "utf8");
  const reviewRoute = readFileSync("src/app/api/v1/operations/[operationId]/financial-review/route.ts", "utf8");
  assert.match(pricingRoute, /accounting\.lithotripsy\.pricing\.manage/);
  assert.match(reviewRoute, /accounting\.review/);
  assert.match(reviewRoute, /accounting\.finance\.edit/);
  console.log("Lithotripsy source-specific pricing checks passed");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => postgresClient.end({ timeout: 1 }));
