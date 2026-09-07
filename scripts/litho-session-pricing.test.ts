import assert from "node:assert/strict";
import { postgresClient } from "@/db/client";
import {
  normalizeProcedureSet,
  resolveLithotripsyPricingProfile,
} from "@/lib/accounting/lithotripsy-profiles";
import { resolveLithotripsyReviewDefaults } from "@/lib/accounting/lithotripsy-pricing";

const rollback = Symbol("rollback");

async function main() {
  try {
    await postgresClient.begin(async (tx) => {
      const [user] = await tx.unsafe<Array<{ id: string }>>("select id from users where archived_at is null order by created_at limit 1");
      assert.ok(user, "active test user required");
      const token = crypto.randomUUID().replaceAll("-", "");
      const procedureIds: string[] = [];
      for (const [index, name] of ["TEST-A-PROC-A", "TEST-A-PROC-B", "TEST-A-PROC-C"].entries()) {
        const [procedure] = await tx.unsafe<Array<{ id: string }>>("insert into procedures(name,normalized_name,category,created_by_user_id) values($1,$2,'اختبار',$3::uuid) returning id", [name, `${name.toLowerCase()}_${token}_${index}`, user.id]);
        procedureIds.push(procedure.id);
      }
      const setA = normalizeProcedureSet([procedureIds[0]]);
      const setB = normalizeProcedureSet([procedureIds[1], procedureIds[0], procedureIds[1]]);
      assert.equal(setB, normalizeProcedureSet([procedureIds[0], procedureIds[1]]), "canonical set is order and duplicate independent");

      async function addProfile(name: string, session: 1 | 2 | null, ids: string[], isBase = false) {
        const key = normalizeProcedureSet(ids);
        const [profile] = await tx.unsafe<Array<{ id: string }>>(`insert into lithotripsy_pricing_profiles(name,normalized_name,procedure_set_key,session_number,is_base,active,version,sort_order,created_by_user_id,updated_by_user_id) values($1,$2,$3,$4,$5,true,1,9000,$6::uuid,$6::uuid) returning id`, [name, `${name.toLowerCase()}_${token}`, key, session, isBase, user.id]);
        for (const [sortOrder, procedureId] of Array.from(new Set(ids)).entries()) await tx.unsafe("insert into lithotripsy_pricing_profile_procedures(profile_id,procedure_id,sort_order) values($1::uuid,$2::uuid,$3)", [profile.id, procedureId, sortOrder]);
        await tx.unsafe("insert into lithotripsy_pricing_profile_lines(profile_id,stable_key,line_type,label,default_amount,effect,sort_order,active,created_by_user_id,updated_by_user_id) values($1::uuid,'technician_test','fixed_cost','فني اختبار',$2,'subtract',0,true,$3::uuid,$3::uuid)", [profile.id, session === 1 ? 111 : session === 2 ? 222 : 333, user.id]);
        return profile.id;
      }

      const s1a = await addProfile("TEST-A-S1-ONLY", 1, [procedureIds[0]], true);
      const s2a = await addProfile("TEST-A-S2-ONLY", 2, [procedureIds[0]], true);
      const s1b = await addProfile("TEST-A-S1-COMBINED", 1, [procedureIds[0], procedureIds[1]]);
      const s2b = await addProfile("TEST-A-S2-COMBINED", 2, [procedureIds[1], procedureIds[0]]);

      async function addOperation(session: 1 | 2, ids: string[]) {
        const [sequence] = await tx.unsafe<Array<{ value: number }>>("select coalesce(max(daily_sequence),0)+1 value from operations where operation_date=current_date");
        const [operation] = await tx.unsafe<Array<{ id: string }>>("insert into operations(type,operation_date,daily_sequence,operation_time,case_name,session_count,created_by_user_id,updated_by_user_id) values('lithotripsy',current_date,$1,'08:00',$2,$3,$4::uuid,$4::uuid) returning id", [sequence.value, `TEST-A-${token}`, session, user.id]);
        for (const procedureId of Array.from(new Set(ids))) await tx.unsafe("insert into operation_procedures(operation_id,procedure_id) values($1::uuid,$2::uuid)", [operation.id, procedureId]);
        return operation.id;
      }

      const operations = {
        s1a: await addOperation(1, [procedureIds[0]]),
        s2a: await addOperation(2, [procedureIds[0]]),
        s1b: await addOperation(1, [procedureIds[1], procedureIds[0], procedureIds[1]]),
        s2b: await addOperation(2, [procedureIds[0], procedureIds[1]]),
      };
      assert.equal((await resolveLithotripsyPricingProfile(operations.s1a, tx)).profile?.id, s1a);
      assert.equal((await resolveLithotripsyPricingProfile(operations.s2a, tx)).profile?.id, s2a);
      assert.equal((await resolveLithotripsyPricingProfile(operations.s1b, tx)).profile?.id, s1b);
      assert.equal((await resolveLithotripsyPricingProfile(operations.s2b, tx)).profile?.id, s2b);
      assert.equal((await resolveLithotripsyPricingProfile(operations.s1b, tx)).procedureSetKey, setB);

      const missingS1 = await addOperation(1, [procedureIds[2]]);
      const missingS2 = await addOperation(2, [procedureIds[2]]);
      const s1Fallback = await resolveLithotripsyPricingProfile(missingS1, tx);
      const s2Fallback = await resolveLithotripsyPricingProfile(missingS2, tx);
      assert.equal(s1Fallback.profile?.id, s1a);
      assert.equal(s1Fallback.matchType, "session_base");
      assert.equal(s2Fallback.profile?.id, s2a);
      assert.equal(s2Fallback.matchType, "session_base");

      await tx.unsafe("update lithotripsy_pricing_profiles set is_base=false where id=$1::uuid", [s2a]);
      const noMatch = await resolveLithotripsyPricingProfile(missingS2, tx);
      assert.equal(noMatch.matchType, "none");
      assert.equal(noMatch.profile, null);
      assert.equal(noMatch.warningCode, "LITHO_PRICING_NOT_CONFIGURED");
      assert.match(noMatch.warningMessage ?? "", /لا توجد قائمة أسعار مطابقة/);

      const legacy = await addProfile("TEST-A-LEGACY", null, [procedureIds[2]]);
      const legacyMatch = await resolveLithotripsyPricingProfile(missingS2, tx);
      assert.equal(legacyMatch.profile?.id, legacy);
      assert.equal(legacyMatch.matchType, "legacy");
      assert.equal(legacyMatch.warningCode, "LITHO_LEGACY_PROFILE");

      const resolvedLines = await resolveLithotripsyReviewDefaults(operations.s1a, tx);
      assert.equal(resolvedLines.profileMatchType, "exact");
      assert.equal(resolvedLines.sessionNumber, 1);
      assert.ok(!resolvedLines.some((line) => line.stableKey.startsWith("session_expenses_")), "session must not create a financial line");

      async function expectConstraint(sql: string, parameters: Array<string | number | boolean | null>) {
        await tx.unsafe("savepoint expected_constraint");
        try {
          await tx.unsafe(sql, parameters);
          assert.fail("expected database uniqueness rejection");
        } catch (error) {
          assert.match(String(error), /duplicate key/i);
          await tx.unsafe("rollback to savepoint expected_constraint");
        }
        await tx.unsafe("release savepoint expected_constraint");
      }
      await expectConstraint("insert into lithotripsy_pricing_profiles(name,normalized_name,procedure_set_key,session_number,is_base,active,version,sort_order,created_by_user_id,updated_by_user_id) values('TEST-A-DUP-S1','test_a_dup_s1',$1,1,false,true,1,9001,$2::uuid,$2::uuid)", [setA, user.id]);
      await expectConstraint("insert into lithotripsy_pricing_profiles(name,normalized_name,procedure_set_key,session_number,is_base,active,version,sort_order,created_by_user_id,updated_by_user_id) values('TEST-A-DUP-S2','test_a_dup_s2',$1,2,false,true,1,9001,$2::uuid,$2::uuid)", [setA, user.id]);
      await expectConstraint("insert into lithotripsy_pricing_profiles(name,normalized_name,procedure_set_key,session_number,is_base,active,version,sort_order,created_by_user_id,updated_by_user_id) values('TEST-A-DUP-BASE','test_a_dup_base',$1,1,true,true,1,9001,$2::uuid,$2::uuid)", [normalizeProcedureSet([procedureIds[2]]), user.id]);

      const [countsBefore] = await tx.unsafe<Array<{ definitions: number; profiles: number; lines: number; versions: number }>>("select (select count(*)::int from lithotripsy_pricing_definitions) definitions,(select count(*)::int from lithotripsy_pricing_profiles) profiles,(select count(*)::int from lithotripsy_pricing_profile_lines) lines,(select coalesce(sum(version),0)::int from lithotripsy_pricing_profiles) versions");
      await resolveLithotripsyPricingProfile(operations.s1a, tx);
      await resolveLithotripsyReviewDefaults(operations.s1a, tx);
      await resolveLithotripsyReviewDefaults(operations.s1a, tx);
      const [countsAfter] = await tx.unsafe<Array<{ definitions: number; profiles: number; lines: number; versions: number }>>("select (select count(*)::int from lithotripsy_pricing_definitions) definitions,(select count(*)::int from lithotripsy_pricing_profiles) profiles,(select count(*)::int from lithotripsy_pricing_profile_lines) lines,(select coalesce(sum(version),0)::int from lithotripsy_pricing_profiles) versions");
      assert.deepEqual(countsAfter, countsBefore, "pricing reads must not write");

      const [review] = await tx.unsafe<Array<{ id: string }>>("insert into operation_financial_reviews(operation_id,main_amount,doctor_account_amount,reviewed_by_user_id) values($1::uuid,1000,1000,$2::uuid) returning id", [operations.s1a, user.id]);
      const [snapshot] = await tx.unsafe<Array<{ id: string; effective_amount: string }>>("insert into operation_financial_items(review_id,kind,description,amount,base_amount,adjustment_amount,effective_amount,financial_effect,source_type,pricing_profile_id,pricing_profile_version,created_by_user_id) values($1::uuid,'financial','فني تاريخي',111,111,0,111,'subtract','other',$2::uuid,1,$3::uuid) returning id,effective_amount", [review.id, s1a, user.id]);
      await tx.unsafe("update lithotripsy_pricing_profile_lines set default_amount=999 where profile_id=$1::uuid and active=true", [s1a]);
      const [unchanged] = await tx.unsafe<Array<{ effective_amount: string }>>("select effective_amount from operation_financial_items where id=$1::uuid", [snapshot.id]);
      assert.equal(Number(unchanged.effective_amount), 111, "historical snapshot remains authoritative");
      const newResolution = await resolveLithotripsyReviewDefaults(await addOperation(1, [procedureIds[0]]), tx);
      assert.equal(newResolution.find((line) => line.stableKey === "technician_test")?.defaultAmount, 999, "new case receives latest active default");

      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  console.log("Lithotripsy session pricing tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => postgresClient.end({ timeout: 1 }));
