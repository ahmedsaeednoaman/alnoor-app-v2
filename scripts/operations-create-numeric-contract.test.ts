import assert from "node:assert/strict";
import { postgresClient } from "@/db/client";
import { createDynamicOperationInTransaction } from "@/lib/operations/dynamic";
import type { DynamicOperationInput } from "@/lib/operations/validation";
import { WorkFormDomainError } from "@/lib/work-forms/validation";

const rollback = Symbol("rollback");
type Field = { stable_key: string; field_type: string; required: boolean; multiple: boolean; smart_dropdown_source: string | null };

async function main() {
  try {
    await postgresClient.begin(async (tx) => {
      const [user] = await tx.unsafe<Array<{ id: string }>>("select id from users where username='tests' and status='active' and archived_at is null");
      const [template] = await tx.unsafe<Array<{ id: string }>>("select id from work_form_templates where operation_type='lithotripsy' and status='published' order by version desc limit 1");
      assert.ok(user && template, "active tests user and published Lithotripsy template are required");
      const fields = await tx.unsafe<Field[]>("select stable_key,field_type,required,multiple,smart_dropdown_source from work_form_fields where template_id=$1::uuid and archived_at is null and show_in_form=true order by sort_order", [template.id]);
      const values: Record<string, string | number | boolean | null | string[]> = {};
      for (const field of fields) values[field.stable_key] = field.multiple ? [] : null;
      values.case_name = "TEST-HOTFIX-CREATE-400";
      values.operation_date = new Date().toISOString().slice(0, 10);
      values.operation_time = "09:00";
      values.session_count = 1;
      for (const field of fields.filter((item) => item.smart_dropdown_source && (item.required || ["doctor", "hospital", "procedures", "anesthesia_type", "anesthesiologist", "technician"].includes(item.stable_key)))) {
        const table = field.smart_dropdown_source === "contract_entities" ? "contract_entities" : field.smart_dropdown_source;
        const rows = await tx.unsafe<Array<{ id: string }>>(`select id from "${table}" where archived_at is null order by created_at limit 1`);
        if (rows[0]) values[field.stable_key] = field.multiple ? [rows[0].id] : rows[0].id;
      }
      const input: DynamicOperationInput = { operationType: "lithotripsy", formTemplateId: template.id, values };
      await assert.rejects(
        () => createDynamicOperationInTransaction(tx, { ...input, values: { ...values, session_count: "1" } }, user),
        (error: unknown) => error instanceof WorkFormDomainError && error.code === "NUMBER_INVALID" && (error.details as { field?: string })?.field === "session_count",
        "the former string default must fail with field-specific diagnostics",
      );
      const created = await createDynamicOperationInTransaction(tx, input, user);
      const [saved] = await tx.unsafe<Array<{ session_count: number; lithotripsy_session_id: string; doctor_id: string; procedure_count: number }>>(`select o.session_count,o.lithotripsy_session_id,o.doctor_id,(select count(*)::int from operation_procedures where operation_id=o.id) procedure_count from operations o where o.id=$1::uuid`, [String(created.id)]);
      assert.equal(saved.session_count, 1);
      assert.ok(saved.lithotripsy_session_id, "dynamic session identity must resolve and persist");
      assert.ok(saved.doctor_id, "smart-dropdown UUID must persist as UUID");
      assert.ok(saved.procedure_count > 0, "smart-multi procedure UUIDs must persist");
      assert.equal(values.operational_amount_received == null, true, "blank optional numeric values remain null/absent");
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  console.log("Operation create numeric contract checks passed with transaction rollback");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => postgresClient.end({ timeout: 1 }));
