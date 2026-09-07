import { postgresClient } from "../src/db/client";
import {
  getFinancialReviewOperation,
  saveFinancialReviewInTransaction,
  signedItemTotal,
} from "../src/lib/accounting/review";
import { OperationDomainError } from "../src/lib/operations/api";
import { financialReviewSchema } from "../src/lib/operations/validation";

const rollback = Symbol("rollback");
let assertions = 0;
const expect = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
  assertions += 1;
};

async function main() {
  try {
    await postgresClient.begin(async (tx) => {
      const [user] = await tx.unsafe<Array<{ id: string }>>(
        "select id from users where archived_at is null order by created_at limit 1",
      );
      expect(Boolean(user), "test user required");
      const auth = {
        id: user.id,
        permissions: ["accounting.review", "accounting.finance.view"],
      };
      const token = crypto.randomUUID().replaceAll("-", "");
      const [doctor] = await tx.unsafe<Array<{ id: string }>>(
        "insert into doctors(name,normalized_name,created_by_user_id) values($1,$2,$3::uuid) returning id",
        ["طبيب اختبار مالي", `finance_doctor_${token}`, user.id],
      );
      const [anesthesiologist] = await tx.unsafe<Array<{ id: string }>>(
        "insert into anesthesiologists(name,normalized_name,created_by_user_id) values($1,$2,$3::uuid) returning id",
        ["طبيب تخدير اختبار", `finance_anesthesia_${token}`, user.id],
      );
      const consumables: Array<{ id: string }> = [];
      for (const name of ["دعامة اختبار", "Guide Wire اختبار"]) {
        const [row] = await tx.unsafe<Array<{ id: string }>>(
          "insert into consumables(name,normalized_name,created_by_user_id) values($1,$2,$3::uuid) returning id",
          [name, `finance_consumable_${token}_${consumables.length}`, user.id],
        );
        consumables.push(row);
      }
      const [version] = await tx.unsafe<Array<{ value: number }>>(
        "select coalesce(max(version),0)+1000 value from work_form_templates where operation_type='lithotripsy'",
      );
      const [template] = await tx.unsafe<Array<{ id: string }>>(
        "insert into work_form_templates(operation_type,name,version,status,published_at,created_by_user_id,updated_by_user_id) values('lithotripsy','WC05 rollback template',$1,'archived',now(),$2::uuid,$2::uuid) returning id",
        [version.value, user.id],
      );
      const [section] = await tx.unsafe<Array<{ id: string }>>(
        "insert into work_form_sections(template_id,stable_key,label,sort_order,is_system_section) values($1::uuid,'finance_context','السياق المالي',0,false) returning id",
        [template.id],
      );
      const addField = async (
        key: string,
        label: string,
        type: string,
        source: string | null,
        financial = false,
        effect: "add" | "subtract" | "neutral" | null = null,
      ) => {
        const [row] = await tx.unsafe<Array<{ id: string }>>(
          `insert into work_form_fields(template_id,section_id,stable_key,label,field_type,required,multiple,sort_order,is_system_field,smart_dropdown_source,show_in_financial_review,is_financial,financial_effect) values($1::uuid,$2::uuid,$3,$4,$5::work_form_field_type,false,$6,(select count(*) from work_form_fields where section_id=$2::uuid),false,$7::work_form_reference_source,true,$8,$9::work_form_financial_effect) returning id`,
          [
            template.id,
            section.id,
            key,
            label,
            type,
            type === "smart_multi",
            source,
            financial,
            effect,
          ],
        );
        return row.id;
      };
      await addField("case_name", "اسم الحالة", "text", null);
      await addField(
        "anesthesiologist",
        "طبيب التخدير",
        "smart_single",
        "anesthesiologists",
      );
      const consumablesField = await addField(
        "consumables",
        "المستلزمات",
        "smart_multi",
        "consumables",
      );
      const moneyField = await addField(
        "wc05_operational_money",
        "خدمة تشغيلية",
        "money",
        null,
        true,
        "add",
      );
      const [sequence] = await tx.unsafe<Array<{ value: number }>>(
        "select coalesce(max(daily_sequence),0)+1 value from operations where operation_date=current_date",
      );
      const [operation] = await tx.unsafe<Array<{ id: string }>>(
        `insert into operations(type,operation_date,daily_sequence,operation_time,case_name,doctor_id,anesthesiologist_id,form_template_id,created_by_user_id,updated_by_user_id) values('lithotripsy',current_date,$1,'10:00','حالة مراجعة اختبار',$2::uuid,$3::uuid,$4::uuid,$5::uuid,$5::uuid) returning id`,
        [sequence.value, doctor.id, anesthesiologist.id, template.id, user.id],
      );
      for (const item of consumables)
        await tx.unsafe(
          "insert into operation_consumables(operation_id,consumable_id) values($1::uuid,$2::uuid)",
          [operation.id, item.id],
        );
      await tx.unsafe(
        "insert into operation_field_values(operation_id,field_id,money_value) values($1::uuid,$2::uuid,450.00)",
        [operation.id, moneyField],
      );

      const projected = await getFinancialReviewOperation(
        operation.id,
        auth,
        tx,
      );
      expect(
        projected.template.id === template.id,
        "historical template must be used",
      );
      expect(
        projected.suggestions.length === 4,
        "anesthesiologist, two consumables and financial field suggested",
      );
      const [before] = await tx.unsafe<Array<{ count: number }>>(
        "select count(*)::int count from operation_financial_items i join operation_financial_reviews r on r.id=i.review_id where r.operation_id=$1::uuid",
        [operation.id],
      );
      expect(before.count === 0, "suggestions must not persist before save");
      try {
        await saveFinancialReviewInTransaction(
          tx,
          operation.id,
          financialReviewSchema.parse({
            expectedUpdatedAt: null,
            mainAmount: "0",
            doctorAccountAmount: "0",
            items: [
              {
                kind: "financial",
                description: "مصدر مزيف",
                amount: "1",
                financialEffect: "add",
                sourceType: "consumable",
                sourceFieldId: consumablesField,
                sourceReferenceId: crypto.randomUUID(),
                notes: null,
              },
            ],
          }),
          auth,
        );
        throw new Error("expected invalid provenance rejection");
      } catch (error) {
        expect(
          error instanceof OperationDomainError &&
            error.code === "INVALID_FINANCIAL_SOURCE",
          "tampered provenance rejected",
        );
      }
      expect(
        signedItemTotal([
          { kind: "financial", financialEffect: "add", amount: "1000" },
          { kind: "financial", financialEffect: "subtract", amount: "200" },
          { kind: "financial", financialEffect: "neutral", amount: "300" },
          { kind: "note", financialEffect: "neutral" },
        ]) === 800,
        "add/subtract/neutral semantics",
      );

      const selected = projected.suggestions[0];
      const input = financialReviewSchema.parse({
        expectedUpdatedAt: null,
        mainAmount: "5000.00",
        doctorAccountAmount: "2500.00",
        notes: "مراجعة اختبار",
        items: [
          {
            kind: "financial",
            description: selected.description,
            amount: "1000",
            financialEffect: "add",
            sourceType: selected.sourceType,
            sourceFieldId: selected.sourceFieldId,
            sourceReferenceId: selected.sourceReferenceId,
            notes: null,
          },
          {
            kind: "financial",
            description: "خصم",
            amount: "200",
            financialEffect: "subtract",
            sourceType: "manual",
            sourceFieldId: null,
            sourceReferenceId: null,
            notes: null,
          },
          {
            kind: "financial",
            description: "محايد",
            amount: "300",
            financialEffect: "neutral",
            sourceType: "manual",
            sourceFieldId: null,
            sourceReferenceId: null,
            notes: null,
          },
          {
            kind: "note",
            description: "ملاحظة اختبار",
            amount: null,
            financialEffect: "neutral",
            sourceType: "manual",
            sourceFieldId: null,
            sourceReferenceId: null,
            notes: null,
          },
        ],
      });
      const saved = await saveFinancialReviewInTransaction(
        tx,
        operation.id,
        input,
        auth,
      );
      expect(
        saved.totalItems === 800,
        "authoritative item total persisted semantics",
      );
      const reopened = await getFinancialReviewOperation(
        operation.id,
        auth,
        tx,
      );
      expect(reopened.review.items.length === 4, "variable items persist");
      expect(reopened.review.totalItems === 800, "reopened total stable");
      expect(
        reopened.suggestions.length === 3,
        "persisted provenance suggestion deduplicated",
      );

      const fresh = financialReviewSchema.parse({
        ...input,
        expectedUpdatedAt: saved.updatedAt,
        notes: "تحديث حديث",
      });
      await saveFinancialReviewInTransaction(tx, operation.id, fresh, auth);
      try {
        await saveFinancialReviewInTransaction(tx, operation.id, fresh, auth);
        throw new Error("expected stale update rejection");
      } catch (error) {
        expect(
          error instanceof OperationDomainError &&
            error.code === "STALE_FINANCIAL_REVIEW",
          "stale save rejected",
        );
      }
      try {
        await getFinancialReviewOperation(
          operation.id,
          { id: user.id, permissions: ["operations.view"] },
          tx,
        );
        throw new Error("expected employee finance denial");
      } catch (error) {
        expect(
          error instanceof OperationDomainError &&
            error.code === "FINANCIAL_ACCESS_DENIED",
          "employee financial access denied",
        );
      }
      const [review] = await tx.unsafe<Array<{ id: string }>>(
        "select id from operation_financial_reviews where operation_id=$1::uuid",
        [operation.id],
      );
      await tx.unsafe(
        "insert into operation_financial_payments(review_id,amount,notes,created_by_user_id) values($1::uuid,500,'دفعة اختبار',$2::uuid)",
        [review.id, user.id],
      );
      const paid = await getFinancialReviewOperation(operation.id, auth, tx);
      expect(
        paid.review.paid === 500 && paid.review.remaining === 5300,
        "paid and remaining derive from payment rows",
      );
      await tx.unsafe(
        "insert into doctor_account_postings(operation_id,review_id,doctor_id,amount,posted_by_user_id) values($1::uuid,$2::uuid,$3::uuid,2500,$4::uuid)",
        [operation.id, review.id, doctor.id, user.id],
      );
      try {
        await tx.unsafe(
          "insert into doctor_account_postings(operation_id,review_id,doctor_id,amount,posted_by_user_id) values($1::uuid,$2::uuid,$3::uuid,2500,$4::uuid)",
          [operation.id, review.id, doctor.id, user.id],
        );
        throw new Error("expected duplicate posting rejection");
      } catch (error) {
        expect(
          (error as { code?: string }).code === "23505",
          "duplicate posting prevented by database",
        );
      }
      expect(
        consumablesField.length > 0,
        "historical consumable field retained",
      );
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await postgresClient.end();
  }
  console.log(`financial review tests passed (${assertions} assertions)`);
}

void main();
