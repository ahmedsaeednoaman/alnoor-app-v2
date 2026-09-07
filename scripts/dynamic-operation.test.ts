import { postgresClient } from "../src/db/client";
import { createDynamicOperationInTransaction } from "../src/lib/operations/dynamic";
import {
  getDynamicOperationDetails,
  updateDynamicOperationInTransaction,
} from "../src/lib/operations/details";
import type { DynamicOperationInput } from "../src/lib/operations/validation";
import { OperationDomainError } from "../src/lib/operations/api";
import { WorkFormDomainError } from "../src/lib/work-forms/validation";

const rollback = Symbol("rollback");
let assertions = 0;
const expect = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
  assertions++;
};
type DetailProjection = {
  sections: Array<{ fields: Array<{ stableKey: string; display: unknown }> }>;
};
const detailFields = (details: unknown) =>
  (details as DetailProjection).sections.flatMap((section) => section.fields);
async function main() {
  try {
    await postgresClient.begin(async (tx) => {
      const [user] = await tx.unsafe<Array<{ id: string }>>(
        "SELECT id FROM users WHERE archived_at IS NULL ORDER BY created_at LIMIT 1",
      );
      expect(Boolean(user), "test user required");
      const [version] = await tx.unsafe<Array<{ value: number }>>(
        "SELECT coalesce(max(version),0)+1000 value FROM work_form_templates WHERE operation_type='contract'",
      );
      const [template] = await tx.unsafe<Array<{ id: string }>>(
        "INSERT INTO work_form_templates(operation_type,name,version,status,published_at,created_by_user_id,updated_by_user_id) VALUES('contract','WC03 rollback template',$1,'archived',now(),$2::uuid,$2::uuid) RETURNING id",
        [version.value, user.id],
      );
      const [section] = await tx.unsafe<Array<{ id: string }>>(
        "INSERT INTO work_form_sections(template_id,stable_key,label,sort_order,is_system_section) VALUES($1::uuid,'basic','اختبار',0,false) RETURNING id",
        [template.id],
      );
      const addField = async (
        key: string,
        label: string,
        type: string,
        required: boolean,
        multiple = false,
        source: string | null = null,
        min: number | null = null,
        max: number | null = null,
      ) => {
        const [row] = await tx.unsafe<Array<{ id: string }>>(
          `INSERT INTO work_form_fields(template_id,section_id,stable_key,label,field_type,required,multiple,sort_order,is_system_field,smart_dropdown_source,min_selections,max_selections) VALUES($1::uuid,$2::uuid,$3,$4,$5::work_form_field_type,$6,$7,(SELECT count(*) FROM work_form_fields WHERE section_id=$2::uuid),false,$8::work_form_reference_source,$9,$10) RETURNING id`,
          [
            template.id,
            section.id,
            key,
            label,
            type,
            required,
            multiple,
            source,
            min,
            max,
          ],
        );
        return row.id;
      };
      await addField("case_name", "اسم الحالة", "text", true);
      await addField("operation_date", "التاريخ", "date", true);
      await addField("operation_time", "الوقت", "time", true);
      const textField = await addField(
        "custom_wc03_text",
        "حقل مطلوب",
        "text",
        true,
      );
      const optionalField = await addField(
        "custom_wc03_optional",
        "حقل اختياري",
        "text",
        false,
      );
      await addField(
        "custom_wc03_single",
        "إجراء واحد",
        "smart_single",
        false,
        false,
        "procedures",
      );
      const multiField = await addField(
        "custom_wc03_multi",
        "إجراءات إضافية",
        "smart_multi",
        true,
        true,
        "procedures",
        1,
        3,
      );
      const moneyField = await addField(
        "custom_wc03_money",
        "قيمة",
        "money",
        false,
      );
      const procedureIds: string[] = [];
      for (let index = 0; index < 4; index++) {
        const [item] = await tx.unsafe<Array<{ id: string }>>(
          "INSERT INTO procedures(name,normalized_name,category,created_by_user_id) VALUES($1,$2,'اختبار',$3::uuid) RETURNING id",
          [`WC03 ${index}`, `wc03_${crypto.randomUUID()}_${index}`, user.id],
        );
        procedureIds.push(item.id);
      }
      const today = new Date().toISOString().slice(0, 10);
      const base: DynamicOperationInput = {
        operationType: "contract",
        formTemplateId: template.id,
        values: {
          case_name: "حالة اختبار",
          operation_date: today,
          operation_time: "10:00",
          custom_wc03_text: "قيمة محفوظة",
          custom_wc03_optional: "قيمة اختيارية",
          custom_wc03_single: procedureIds[1],
          custom_wc03_multi: [procedureIds[0]],
          custom_wc03_money: "12.34",
        },
      };
      const fails = async (payload: typeof base, code: string) => {
        try {
          await createDynamicOperationInTransaction(tx, payload, user);
          throw new Error(`Expected ${code}`);
        } catch (error) {
          expect(
            error instanceof WorkFormDomainError && error.code === code,
            `Expected ${code}, received ${error instanceof WorkFormDomainError ? error.code : String(error)}`,
          );
        }
      };
      await fails(
        { ...base, values: { ...base.values, custom_wc03_text: null } },
        "REQUIRED_FIELD_MISSING",
      );
      await fails(
        { ...base, values: { ...base.values, custom_wc03_multi: [] } },
        "MIN_SELECTIONS_NOT_MET",
      );
      await fails(
        {
          ...base,
          values: { ...base.values, custom_wc03_multi: procedureIds },
        },
        "MAX_SELECTIONS_EXCEEDED",
      );
      await fails(
        { ...base, values: { ...base.values, fake_admin_money: 999 } },
        "UNKNOWN_DYNAMIC_FIELD",
      );
      const [draft] = await tx.unsafe<Array<{ id: string }>>(
        "SELECT id FROM work_form_templates WHERE operation_type='contract' AND status='draft' ORDER BY updated_at DESC LIMIT 1",
      );
      expect(Boolean(draft), "draft template required for immutable-version check");
      await fails(
        { ...base, formTemplateId: draft.id },
        "DRAFT_SUBMISSION_FORBIDDEN",
      );
      const before = await tx.unsafe<Array<{ count: number }>>(
        "SELECT count(*)::int count FROM operations WHERE form_template_id=$1::uuid",
        [template.id],
      );
      expect(before[0].count === 0, "failed submissions must be atomic");
      const created = await createDynamicOperationInTransaction(tx, base, user);
      expect(Boolean(created.id), "operation created");
      const [operation] = await tx.unsafe<Array<{ form_template_id: string }>>(
        "SELECT form_template_id FROM operations WHERE id=$1::uuid",
        [String(created.id)],
      );
      expect(
        operation.form_template_id === template.id,
        "loaded template version retained",
      );
      const scalars = await tx.unsafe<
        Array<{
          field_id: string;
          text_value: string | null;
          money_value: string | null;
        }>
      >(
        "SELECT field_id,text_value,money_value FROM operation_field_values WHERE operation_id=$1::uuid",
        [String(created.id)],
      );
      expect(
        scalars.some(
          (row) =>
            row.field_id === textField && row.text_value === "قيمة محفوظة",
        ),
        "custom text persisted",
      );
      expect(
        scalars.some(
          (row) => row.field_id === moneyField && row.money_value === "12.34",
        ),
        "money persisted as decimal",
      );
      expect(
        !scalars.some((row) => row.text_value === ""),
        "optional blank omitted",
      );
      const refs = await tx.unsafe<
        Array<{ field_id: string; reference_id: string }>
      >(
        "SELECT field_id,reference_id FROM operation_field_reference_values WHERE operation_id=$1::uuid",
        [String(created.id)],
      );
      expect(
        refs.length === 1 &&
          refs[0].field_id === multiField &&
          refs[0].reference_id === procedureIds[0],
        "smart multi normalized",
      );
      const owner = {
        id: user.id,
        role: { code: "owner" },
        permissions: [
          "operations.view",
          "operations.edit",
          "operations.cancel",
          "financial.review.view",
        ],
      };
      const employee = {
        id: user.id,
        role: { code: "employee" },
        permissions: ["operations.view", "operations.edit"],
      };
      await tx.unsafe(
        "UPDATE procedures SET archived_at=now() WHERE id=$1::uuid",
        [procedureIds[1]],
      );
      const historical = await getDynamicOperationDetails(
        String(created.id),
        owner,
        true,
        tx,
      );
      expect(
        historical.template?.id === template.id,
        "details resolves exact historical template",
      );
      expect(
        detailFields(historical).some(
          (field) =>
            field.stableKey === "custom_wc03_single" &&
            field.display === "WC03 1",
        ),
        "archived reference label remains readable",
      );
      const employeeDetails = await getDynamicOperationDetails(
        String(created.id),
        employee,
        false,
        tx,
      );
      expect(
        !("financial" in employeeDetails),
        "employee response omits finance key",
      );
      const [review] = await tx.unsafe<Array<{ id: string }>>(
        "INSERT INTO operation_financial_reviews(operation_id,status,main_amount,doctor_account_amount,reviewed_by_user_id) VALUES($1::uuid,'reviewed',500,300,$2::uuid) RETURNING id",
        [String(created.id), user.id],
      );
      await tx.unsafe(
        "INSERT INTO operation_financial_items(review_id,kind,description,amount,created_by_user_id) VALUES($1::uuid,'financial','اختبار',50,$2::uuid)",
        [review.id, user.id],
      );
      const ownerFinancial = await getDynamicOperationDetails(
        String(created.id),
        owner,
        true,
        tx,
      );
      expect(
        "financial" in ownerFinancial &&
          ownerFinancial.financial?.doctorAccountAmount === 300,
        "authorized finance included",
      );
      const edited = {
        ...base.values,
        case_name: "حالة معدلة",
        custom_wc03_text: "نص معدل",
        custom_wc03_optional: null,
        custom_wc03_single: procedureIds[2],
        custom_wc03_multi: [procedureIds[2], procedureIds[3]],
        custom_wc03_money: "99.50",
      };
      const sequence = historical.operation.dailySequence;
      await updateDynamicOperationInTransaction(
        tx,
        String(created.id),
        { formTemplateId: template.id, values: edited },
        owner,
      );
      const afterEdit = await getDynamicOperationDetails(
        String(created.id),
        owner,
        false,
        tx,
      );
      expect(
        afterEdit.operation.caseName === "حالة معدلة",
        "normalized core updated",
      );
      expect(
        afterEdit.operation.dailySequence === sequence,
        "daily sequence immutable",
      );
      const editedFields = detailFields(afterEdit);
      expect(
        editedFields.some(
          (field) =>
            field.stableKey === "custom_wc03_text" &&
            field.display === "نص معدل",
        ),
        "custom text edit visible",
      );
      expect(
        editedFields.some(
          (field) =>
            field.stableKey === "custom_wc03_money" &&
            field.display === "99.50",
        ),
        "custom money edit visible",
      );
      expect(
        editedFields.some(
          (field) =>
            field.stableKey === "custom_wc03_single" &&
            field.display === "WC03 2",
        ),
        "smart single edit visible",
      );
      expect(
        editedFields.some(
          (field) =>
            field.stableKey === "custom_wc03_multi" &&
            Array.isArray(field.display) &&
            field.display.length === 2,
        ),
        "smart multi edit visible",
      );
      const [optionalCount] = await tx.unsafe<Array<{ count: number }>>(
        "SELECT count(*)::int count FROM operation_field_values WHERE operation_id=$1::uuid AND field_id=$2::uuid",
        [String(created.id), optionalField],
      );
      expect(optionalCount.count === 0, "cleared optional scalar row removed");
      try {
        await updateDynamicOperationInTransaction(
          tx,
          String(created.id),
          {
            formTemplateId: template.id,
            values: { ...edited, custom_wc03_text: null },
          },
          owner,
        );
        throw new Error("required bypass accepted");
      } catch (error) {
        expect(
          error instanceof WorkFormDomainError &&
            error.code === "REQUIRED_FIELD_MISSING",
          "required edit bypass rejected",
        );
      }
      const unchanged = await getDynamicOperationDetails(
        String(created.id),
        owner,
        false,
        tx,
      );
      expect(
        unchanged.operation.caseName === "حالة معدلة",
        "failed edit rolled back",
      );
      await updateDynamicOperationInTransaction(
        tx,
        String(created.id),
        {
          formTemplateId: template.id,
          values: { ...edited, case_name: "تعديل موظف" },
        },
        employee,
      );
      expect(
        (await getDynamicOperationDetails(String(created.id), owner, false, tx))
          .operation.caseName === "تعديل موظف",
        "recent employee edit allowed",
      );
      await tx.unsafe(
        "UPDATE operations SET created_at=now()-interval '49 hours' WHERE id=$1::uuid",
        [String(created.id)],
      );
      try {
        await updateDynamicOperationInTransaction(
          tx,
          String(created.id),
          {
            formTemplateId: template.id,
            values: { ...edited, case_name: "مرفوض" },
          },
          employee,
        );
        throw new Error("expired employee edit accepted");
      } catch (error) {
        expect(
          error instanceof OperationDomainError &&
            error.code === "OPERATION_EDIT_WINDOW_CLOSED",
          "48-hour edit window enforced",
        );
      }
      await updateDynamicOperationInTransaction(
        tx,
        String(created.id),
        {
          formTemplateId: template.id,
          values: { ...edited, case_name: "تعديل مالك" },
        },
        owner,
      );
      expect(
        (await getDynamicOperationDetails(String(created.id), owner, false, tx))
          .operation.caseName === "تعديل مالك",
        "owner edit bypasses employee window",
      );
      try {
        await updateDynamicOperationInTransaction(
          tx,
          String(created.id),
          { formTemplateId: draft.id, values: edited },
          owner,
        );
        throw new Error("template migration accepted");
      } catch (error) {
        expect(
          error instanceof OperationDomainError &&
            error.code === "TEMPLATE_VERSION_IMMUTABLE",
          "template version immutable",
        );
      }
      await tx.unsafe(
        "UPDATE operations SET operation_date=current_date-7 WHERE id=$1::uuid",
        [String(created.id)],
      );
      try {
        await getDynamicOperationDetails(
          String(created.id),
          employee,
          false,
          tx,
        );
        throw new Error("old employee details exposed");
      } catch (error) {
        expect(
          error instanceof OperationDomainError &&
            error.code === "OPERATION_NOT_FOUND",
          "7-day direct access enforced",
        );
      }
      expect(
        Boolean(
          await getDynamicOperationDetails(
            String(created.id),
            owner,
            false,
            tx,
          ),
        ),
        "owner history unaffected",
      );
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  console.log(
    `${assertions} dynamic operation persistence scenarios passed with transaction rollback.`,
  );
  await postgresClient.end();
}
void main().catch(async (error) => {
  console.error(error);
  await postgresClient.end();
  process.exitCode = 1;
});
