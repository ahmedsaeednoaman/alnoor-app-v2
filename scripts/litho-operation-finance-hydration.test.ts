import assert from "node:assert/strict";
import { postgresClient } from "@/db/client";
import { getFinancialReviewOperation, saveFinancialReviewInTransaction, signedItemTotal } from "@/lib/accounting/review";
import { financialReviewSchema } from "@/lib/operations/validation";

type Row = Record<string, unknown>;
const rollback = Symbol("rollback");

async function main() {
  try {
    await postgresClient.begin(async (tx) => {
      const [user] = await tx.unsafe<Array<{ id: string }>>("select id from users where username='tests' and archived_at is null");
      const [template] = await tx.unsafe<Array<{ id: string }>>("select id from work_form_templates where operation_type='lithotripsy' and status='published' order by version desc limit 1");
      const [sessionOne] = await tx.unsafe<Array<{ id: string }>>("select id from lithotripsy_sessions where session_number=1 and active=true and archived_at is null");
      assert.ok(user && template && sessionOne, "active tests user, Session 1, and published Lithotripsy form are required");
      const auth = { id: user.id, permissions: ["accounting.review", "accounting.finance.view", "accounting.finance.edit"] };
      const token = crypto.randomUUID().replaceAll("-", "");
      const [procedure] = await tx.unsafe<Array<{ id: string }>>("insert into procedures(name,normalized_name,category,created_by_user_id) values($1,$2,'اختبار',$3::uuid) returning id", [`TEST-B24-PROC-${token}`, `test_b24_proc_${token}`, user.id]);
      const technicians: Array<{ id: string; name: string }> = [];
      for (const suffix of ["A", "B"]) {
        const [item] = await tx.unsafe<Array<{ id: string; name: string }>>("insert into technicians(name,normalized_name,created_by_user_id) values($1,$2,$3::uuid) returning id,name", [`TEST-B24-TECH-${suffix}-${token}`, `test_b24_tech_${suffix.toLowerCase()}_${token}`, user.id]);
        technicians.push(item);
      }
      const equipment: Array<{ id: string; name: string }> = [];
      for (const suffix of ["A", "B"]) {
        const [item] = await tx.unsafe<Array<{ id: string; name: string }>>("insert into equipment(name,normalized_name,equipment_type,created_by_user_id) values($1,$2,(select equipment_type from equipment limit 1),$3::uuid) returning id,name", [`TEST-B24-EQUIPMENT-${suffix}-${token}`, `test_b24_equipment_${suffix.toLowerCase()}_${token}`, user.id]);
        equipment.push(item);
      }
      const [consumable] = await tx.unsafe<Array<{ id: string; name: string }>>("insert into consumables(name,normalized_name,created_by_user_id) values($1,$2,$3::uuid) returning id,name", [`TEST-B24-UNPRICED-${token}`, `test_b24_unpriced_${token}`, user.id]);
      const [stent] = await tx.unsafe<Array<{ id: string; name: string }>>("insert into stents(name,normalized_name,created_by_user_id) values($1,$2,$3::uuid) returning id,name", [`TEST-B24-ZERO-${token}`, `test_b24_zero_${token}`, user.id]);
      const [profile] = await tx.unsafe<Array<{ id: string }>>(`insert into lithotripsy_pricing_profiles(name,normalized_name,procedure_set_key,session_number,session_id,is_base,active,version,sort_order,created_by_user_id,updated_by_user_id)
        values($1,$2,$3,1,$4::uuid,false,true,1,9950,$5::uuid,$5::uuid) returning id`, [`TEST-B24B-LIST-${token}`, `test_b24b_list_${token}`, procedure.id, sessionOne.id, user.id]);
      await tx.unsafe("insert into lithotripsy_pricing_profile_procedures(profile_id,procedure_id,sort_order) values($1::uuid,$2::uuid,0)", [profile.id, procedure.id]);
      const profileLines = [
        ["tech_generic", "linked_role", "الفني — افتراضي", 450, "technician", null],
        ["tech_specific", "linked_source", `الفني — ${technicians[0].name}`, 700, "technician", technicians[0].id],
        ["equipment_generic", "linked_role", "الأجهزة — افتراضي", 200, "equipment", null],
        ["equipment_specific", "linked_source", `الأجهزة — ${equipment[0].name}`, 350, "equipment", equipment[0].id],
        ["stent_zero", "linked_source", `الدعامات — ${stent.name}`, 0, "stent", stent.id],
        ["nursing_fixed", "fixed_cost", "تمريض وعمال", 200, null, null],
      ];
      for (const [sortOrder, line] of profileLines.entries()) await tx.unsafe(`insert into lithotripsy_pricing_profile_lines(profile_id,stable_key,line_type,label,default_amount,effect,source_type,source_reference_id,sort_order,active,created_by_user_id,updated_by_user_id)
        values($1::uuid,$2,$3,$4,$5,'subtract',$6,$7::uuid,$8,true,$9::uuid,$9::uuid)`, [profile.id, ...line, sortOrder, user.id]);

      async function addOperation(session: 1 | 2, technicianId: string, withSources = false) {
        const [sequence] = await tx.unsafe<Array<{ value: number }>>("select coalesce(max(daily_sequence),0)+1 value from operations where operation_date=current_date");
        const sessionRows=await tx.unsafe<Array<{id:string}>>("select id from lithotripsy_sessions where session_number=$1 and active=true and archived_at is null",[session]);
        const [operation] = await tx.unsafe<Array<{ id: string }>>(`insert into operations(type,operation_date,daily_sequence,operation_time,case_name,session_count,lithotripsy_session_id,technician_id,form_template_id,created_by_user_id,updated_by_user_id)
          values('lithotripsy',current_date,$1,'11:00',$2,$3,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$7::uuid) returning id`, [sequence.value, `TEST-B24B-OP-${crypto.randomUUID()}`, session, sessionRows[0]?.id ?? null, technicianId, template.id, user.id]);
        await tx.unsafe("insert into operation_procedures(operation_id,procedure_id) values($1::uuid,$2::uuid)", [operation.id, procedure.id]);
        if (withSources) {
          for (const item of equipment) await tx.unsafe("insert into operation_equipment(operation_id,equipment_id) values($1::uuid,$2::uuid)", [operation.id, item.id]);
          await tx.unsafe("insert into operation_consumables(operation_id,consumable_id) values($1::uuid,$2::uuid)", [operation.id, consumable.id]);
          await tx.unsafe("insert into operation_stents(operation_id,stent_id,sort_order) values($1::uuid,$2::uuid,0)", [operation.id, stent.id]);
        }
        return operation.id;
      }

      const operationId = await addOperation(1, technicians[0].id, true);
      await assert.rejects(() => getFinancialReviewOperation(operationId, { id: user.id, permissions: [] }, tx), /صلاحية عرض المراجعة المالية/, "employee/no-finance role must not receive the financial payload");
      const [before] = await tx.unsafe<Row[]>(`select
        (select count(*)::int from operation_financial_reviews where operation_id=$1::uuid) reviews,
        (select count(*)::int from operation_financial_items where review_id in (select id from operation_financial_reviews where operation_id=$1::uuid)) items,
        (select count(*)::int from lithotripsy_pricing_profiles) profiles,
        (select count(*)::int from lithotripsy_pricing_profile_lines) lines,
        (select count(*)::int from lithotripsy_pricing_definitions) definitions,
        (select coalesce(sum(version),0)::int from lithotripsy_pricing_profiles) versions`, [operationId]);
      const first = await getFinancialReviewOperation(operationId, auth, tx) as Row;
      const second = await getFinancialReviewOperation(operationId, auth, tx) as Row;
      assert.deepEqual(second.hydratedFinancialItems, first.hydratedFinancialItems, "repeated hydration must be deterministic");
      assert.equal((first.pricingProfile as Row).id, profile.id, "Session 1 exact profile must match");
      assert.equal((first.pricingProfile as Row).matchType, "exact");
      const hydrated = first.hydratedFinancialItems as Row[];
      const tech = hydrated.find((line) => line.sourceType === "technician");
      assert.equal(tech?.baseAmount, "700");
      assert.equal(tech?.pricingOrigin, "specific_source_default");
      assert.equal(hydrated.filter((line) => line.sourceType === "technician").length, 1, "one operational source must produce one financial line");
      const equipmentLines = hydrated.filter((line) => line.sourceType === "equipment");
      assert.equal(equipmentLines.length, 2, "two equipment selections must produce two rows");
      assert.deepEqual(equipmentLines.map((line) => [line.sourceReferenceId, line.baseAmount, line.pricingOrigin]).sort(), [[equipment[0].id, "350", "specific_source_default"], [equipment[1].id, "200", "profile_role_default"]].sort());
      const unpriced = hydrated.find((line) => line.sourceReferenceId === consumable.id);
      assert.equal(unpriced?.baseAmount, null);
      assert.equal(unpriced?.amount, null);
      assert.equal(unpriced?.pricingOrigin, "none");
      const explicitZero = hydrated.find((line) => line.sourceReferenceId === stent.id);
      assert.equal(explicitZero?.baseAmount, "0");
      assert.equal(explicitZero?.amount, "0");
      assert.ok(hydrated.some((line) => line.pricingOrigin === "profile_fixed_line" && line.description === "تمريض وعمال"), "fixed profile line must hydrate");
      const [afterReads] = await tx.unsafe<Row[]>(`select
        (select count(*)::int from operation_financial_reviews where operation_id=$1::uuid) reviews,
        (select count(*)::int from operation_financial_items where review_id in (select id from operation_financial_reviews where operation_id=$1::uuid)) items,
        (select count(*)::int from lithotripsy_pricing_profiles) profiles,
        (select count(*)::int from lithotripsy_pricing_profile_lines) lines,
        (select count(*)::int from lithotripsy_pricing_definitions) definitions,
        (select coalesce(sum(version),0)::int from lithotripsy_pricing_profiles) versions`, [operationId]);
      assert.deepEqual(afterReads, before, "opening an unsaved review must not write review, item, or pricing state");

      const genericOperation = await addOperation(1, technicians[1].id);
      const genericDraft = await getFinancialReviewOperation(genericOperation, auth, tx) as Row;
      assert.equal((genericDraft.hydratedFinancialItems as Row[]).find((line) => line.sourceType === "technician")?.baseAmount, "450");
      await tx.unsafe("update operations set technician_id=$2::uuid where id=$1::uuid", [genericOperation, technicians[0].id]);
      const changedDraft = await getFinancialReviewOperation(genericOperation, auth, tx) as Row;
      assert.equal((changedDraft.hydratedFinancialItems as Row[]).find((line) => line.sourceType === "technician")?.baseAmount, "700", "operation source change before save must refresh hydration");
      const session2 = await getFinancialReviewOperation(await addOperation(2, technicians[0].id), auth, tx) as Row;
      assert.notEqual((session2.pricingProfile as Row | null)?.id, profile.id, "Session 2 must not use Session 1 profile");

      const saveItems = hydrated.map((line) => ({ ...line }));
      const technicianIndex = saveItems.findIndex((line) => line.sourceType === "technician");
      saveItems[technicianIndex] = { ...saveItems[technicianIndex], amount: "400", effectiveAmount: "400", adjustmentAmount: "-300", notes: "تم تخفيض القيمة لهذه الحالة فقط" };
      const unpricedIndex = saveItems.findIndex((line) => line.sourceReferenceId === consumable.id);
      saveItems[unpricedIndex] = { ...saveItems[unpricedIndex], amount: "750", effectiveAmount: "750" };
      const fixedIndex = saveItems.findIndex((line) => line.description === "تمريض وعمال");
      saveItems[fixedIndex] = { ...saveItems[fixedIndex], caseLineState: "excluded" };
      const persistedItems = saveItems.map((item) => {
        const { pricingOrigin, ...line } = item;
        void pricingOrigin;
        return line;
      });
      persistedItems.push({ kind: "financial", description: "TEST-B24-MANUAL", amount: "50", baseAmount: null, adjustmentAmount: null, effectiveAmount: "50", caseLineState: "included", financialEffect: "add", sourceType: "manual", sourceFieldId: null, sourceReferenceId: null, definitionId: null, pricingProfileId: null, pricingProfileLineId: null, pricingProfileVersion: null, notes: "manual" });
      persistedItems.push({ kind: "financial", description: "TEST-B24B-MANUAL-SUBTRACT", amount: "25", baseAmount: null, adjustmentAmount: null, effectiveAmount: "25", caseLineState: "included", financialEffect: "subtract", sourceType: "manual", sourceFieldId: null, sourceReferenceId: null, definitionId: null, pricingProfileId: null, pricingProfileLineId: null, pricingProfileVersion: null, notes: null });
      persistedItems.push({ kind: "financial", description: "TEST-B24B-MANUAL-NEUTRAL", amount: "100", baseAmount: null, adjustmentAmount: null, effectiveAmount: "100", caseLineState: "included", financialEffect: "neutral", sourceType: "manual", sourceFieldId: null, sourceReferenceId: null, definitionId: null, pricingProfileId: null, pricingProfileLineId: null, pricingProfileVersion: null, notes: null });
      persistedItems.push({ kind: "note", description: "TEST-B24-NOTE", amount: null, baseAmount: null, adjustmentAmount: null, effectiveAmount: null, caseLineState: "included", financialEffect: "neutral", sourceType: "manual", sourceFieldId: null, sourceReferenceId: null, definitionId: null, pricingProfileId: null, pricingProfileLineId: null, pricingProfileVersion: null, notes: null });
      const input = financialReviewSchema.parse({ expectedUpdatedAt: null, mainAmount: "1000", doctorBalanceReceived: false, notes: "TEST-B24-REVIEW-NOTE", items: persistedItems });
      await saveFinancialReviewInTransaction(tx, operationId, input, auth);
      await tx.unsafe("update lithotripsy_pricing_profile_lines set default_amount=725 where profile_id=$1::uuid and stable_key='tech_specific'", [profile.id]);
      await tx.unsafe("update technicians set name=$2 where id=$1::uuid", [technicians[0].id, `TEST-B24-TECH-RENAMED-${token}`]);
      const saved = await getFinancialReviewOperation(operationId, auth, tx) as Row;
      const savedItems = (saved.review as Row).items as Row[];
      assert.equal(Number(savedItems.find((line) => line.sourceType === "technician")?.baseAmount), 700, "saved reference remains historical after default change");
      assert.equal(Number(savedItems.find((line) => line.sourceType === "technician")?.effectiveAmount), 400, "case override remains authoritative");
      assert.equal(savedItems.find((line) => line.sourceType === "technician")?.notes, "تم تخفيض القيمة لهذه الحالة فقط");
      assert.equal(savedItems.find((line) => line.sourceType === "technician")?.sourceReferenceId, technicians[0].id, "stable source UUID survives rename");
      assert.ok(savedItems.some((line) => line.description === "TEST-B24-MANUAL" && line.sourceType === "manual"));
      assert.ok(savedItems.some((line) => line.kind === "note" && line.financialEffect === "neutral"));
      assert.equal(savedItems.find((line) => line.description === "تمريض وعمال")?.caseLineState, "excluded");
      assert.equal((saved.hydratedFinancialItems as Row[]).length, 0, "saved reviews must not be re-hydrated");
      assert.equal(signedItemTotal([{kind:"financial",financialEffect:"add",effectiveAmount:50},{kind:"financial",financialEffect:"subtract",effectiveAmount:25},{kind:"financial",financialEffect:"neutral",effectiveAmount:100}]),25,"manual add/subtract/neutral semantics remain canonical");
      const fresh = await getFinancialReviewOperation(await addOperation(1, technicians[0].id), auth, tx) as Row;
      assert.equal((fresh.hydratedFinancialItems as Row[]).find((line) => line.sourceType === "technician")?.baseAmount, "725", "fresh operation receives current default");
      assert.match(String((fresh.hydratedFinancialItems as Row[]).find((line) => line.sourceType === "technician")?.description), /RENAMED/, "fresh display follows renamed catalog while UUID identity remains priced");
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  console.log("Lithotripsy operation-to-finance hydration checks passed");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => postgresClient.end({ timeout: 1 }));
