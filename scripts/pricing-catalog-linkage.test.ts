import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { postgresClient } from "../src/db/client";
import { listServicePricingSources, resolveServicePricingCatalogItem } from "../src/lib/accounting/service-pricing-sources";
import { resolveServicePricing } from "../src/lib/accounting/service-pricing";
import { resolveSourcePrice } from "../src/lib/accounting/lithotripsy-source-pricing";

const rollback = Symbol("rollback");
async function main() {
try {
  await postgresClient.begin(async (tx) => {
    const [user] = await tx.unsafe<Array<{ id: string }>>("select id from users where status='active' order by created_at limit 1");
    const [contractTemplate] = await tx.unsafe<Array<{ id: string }>>("select id from work_form_templates where operation_type='contract' and status='published' limit 1");
    const [endoscopyTemplate] = await tx.unsafe<Array<{ id: string }>>("select id from work_form_templates where operation_type='endoscopy' and status='published' limit 1");
    assert.ok(user && contractTemplate && endoscopyTemplate);

    const contractSources = await listServicePricingSources("contract");
    const endoscopySources = await listServicePricingSources("endoscopy");
    assert.deepEqual(contractSources.map((item) => item.catalogSource).sort(), ["consumables", "equipment", "procedures"]);
    assert.deepEqual(endoscopySources.map((item) => item.catalogSource).sort(), ["consumables", "equipment", "procedures"]);
    assert.equal(contractSources.some((item) => item.catalogSource === "stents"), false, "Contract picker must not offer a source absent from its published form");

    const token = crypto.randomUUID().slice(0, 8);
    const [equipment] = await tx.unsafe<Array<{ id: string; name: string }>>(`insert into equipment(name,normalized_name,equipment_type,is_active,created_by_user_id) values($1,$2,'عام',true,$3::uuid) returning id,name`, [`TEST-LINK-تاور-${token}`, `test-link-tower-${token}`, user.id]);
    const hospitals = await tx.unsafe<Array<{ id: string }>>(`insert into hospitals(name,normalized_name,is_active,created_by_user_id) values($1,$2,true,$5::uuid),($3,$4,true,$5::uuid) returning id`, [`TEST-LINK-A-${token}`, `test-link-a-${token}`, `TEST-LINK-B-${token}`, `test-link-b-${token}`, user.id]);
    const canonical = await resolveServicePricingCatalogItem("contract", "equipment", equipment.id, tx);
    assert.equal(canonical.id, equipment.id);
    assert.match(canonical.label, new RegExp(equipment.name));

    const makeProfile = async (type: "contract" | "endoscopy", hospitalId: string | null, amount: number) => {
      const [profile] = await tx.unsafe<Array<{ id: string }>>(`insert into service_pricing_profiles(operation_type,hospital_id,name,created_by_user_id,updated_by_user_id) values($1::operation_type,$2::uuid,$3,$4::uuid,$4::uuid) returning id`, [type, hospitalId, `TEST-LINK-${type}-${amount}-${token}`, user.id]);
      await tx.unsafe(`insert into service_pricing_items(profile_id,stable_key,source_type,source_reference_id,label,default_amount,created_by_user_id,updated_by_user_id) values($1::uuid,$2,'equipment',$3::uuid,$4,$5,$6::uuid,$6::uuid)`, [profile.id, `equipment:${equipment.id}`, equipment.id, `الأجهزة — ${equipment.name}`, amount, user.id]);
      return profile.id;
    };
    await makeProfile("contract", hospitals[0].id, 2000);
    await makeProfile("contract", hospitals[1].id, 2800);
    await tx.unsafe("update service_pricing_profiles set active=false,archived_at=now() where operation_type='endoscopy' and active=true");
    await makeProfile("endoscopy", null, 2500);

    const makeOperation = async (type: "contract" | "endoscopy", hospitalId: string, templateId: string) => {
      const [operation] = await tx.unsafe<Array<{ id: string }>>(`insert into operations(type,operation_date,daily_sequence,operation_time,case_name,hospital_id,created_by_user_id,updated_by_user_id,form_template_id) values($1::operation_type,current_date,(select coalesce(max(daily_sequence),0)+1 from operations where operation_date=current_date),'09:00',$2,$3::uuid,$4::uuid,$4::uuid,$5::uuid) returning id`, [type, `TEST-LINK-${type}-${token}`, hospitalId, user.id, templateId]);
      await tx.unsafe("insert into operation_equipment(operation_id,equipment_id) values($1::uuid,$2::uuid)", [operation.id, equipment.id]);
      return operation.id;
    };
    const operationA = await makeOperation("contract", hospitals[0].id, contractTemplate.id);
    const operationB = await makeOperation("contract", hospitals[1].id, contractTemplate.id);
    const endoscopyOperation = await makeOperation("endoscopy", hospitals[0].id, endoscopyTemplate.id);
    const price = async (operationId: string) => (await resolveServicePricing(operationId, tx)).prices.find((item) => item.source?.sourceReferenceId === equipment.id)?.defaultAmount;
    assert.equal(await price(operationA), 2000, "Hospital A resolves by hospital + equipment UUID");
    assert.equal(await price(operationB), 2800, "Hospital B resolves a different price for the same equipment UUID");
    assert.equal(await price(endoscopyOperation), 2500, "Endoscopy resolves its general default by the same equipment UUID");

    assert.equal(resolveSourcePrice({ profileLines: [{ lineType: "linked_source", sourceType: "equipment", sourceReferenceId: equipment.id, defaultAmount: 900 }], sourceType: "equipment", sourceReferenceId: equipment.id }).resolvedAmount, 900, "Lithotripsy uses the exact catalog UUID");
    await tx.unsafe("update equipment set archived_at=now(),is_active=false where id=$1::uuid", [equipment.id]);
    assert.equal(await price(operationA), 2000, "an archived catalog item remains readable through historical operation identity");
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
}

const component = readFileSync("src/components/accounting/service-pricing-library.tsx", "utf8");
assert.match(component, /اختيار من البنود المسجلة/);
assert.match(component, /بند مالي ثابت/);
assert.match(component, /sourceReferenceId/);
assert.doesNotMatch(component, /const sourceOptions = \[/, "service pricing categories must not be a hardcoded catalog list");
console.log("Catalog-to-pricing UUID linkage checks passed with transaction rollback");
await postgresClient.end();
}

main().catch(async (error) => {
  console.error(error);
  await postgresClient.end();
  process.exitCode = 1;
});
