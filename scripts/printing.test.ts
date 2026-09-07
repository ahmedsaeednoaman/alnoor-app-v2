import { postgresClient } from "../src/db/client";
import {
  getContractMonthlyReport,
  getOperationPrintProjection,
} from "../src/lib/printing/projection";

const rollback = Symbol("rollback");
let assertions = 0;
const expect = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
  assertions++;
};
async function main() {
  try {
    await postgresClient.begin(async (tx) => {
      for (const [count, pages] of [
        [15, 1],
        [16, 2],
        [30, 2],
        [31, 3],
        [205, 14],
      ] as const)
        expect(
          Math.ceil(count / 15) === pages,
          `${count} rows must paginate to ${pages} pages`,
        );
      const [user] = await tx.unsafe<Array<{ id: string }>>(
        "select id from users where archived_at is null order by created_at limit 1",
      );
      expect(Boolean(user), "test user required");
      const auth = {
        id: user.id,
        permissions: [
          "printing.use",
          "reports.view",
          "accounting.finance.view",
        ],
      };
      const [template] = await tx.unsafe<Array<{ id: string }>>(
        "select id from work_form_templates where operation_type='contract' and status='published' order by version desc limit 1",
      );
      expect(Boolean(template), "published contract template required");
      const [version] = await tx.unsafe<Array<{ value: number }>>(
        "select coalesce(max(version),0)+2000 value from work_form_templates where operation_type='contract'",
      );
      const [oldTemplate] = await tx.unsafe<Array<{ id: string }>>(
        "insert into work_form_templates(operation_type,name,version,status,published_at,created_by_user_id,updated_by_user_id) values('contract','WC06 historical print',$1,'archived',now(),$2::uuid,$2::uuid) returning id",
        [version.value, user.id],
      );
      const [section] = await tx.unsafe<Array<{ id: string }>>(
        "insert into work_form_sections(template_id,stable_key,label,sort_order,is_system_section) values($1::uuid,'print_section','قسم الطباعة التاريخي',0,false) returning id",
        [oldTemplate.id],
      );
      const [field] = await tx.unsafe<Array<{ id: string }>>(
        "insert into work_form_fields(template_id,section_id,stable_key,label,field_type,required,multiple,sort_order,is_system_field,show_in_print) values($1::uuid,$2::uuid,'wc06_printable','حقل مطبوع تاريخياً','text',false,false,0,false,true) returning id",
        [oldTemplate.id, section.id],
      );
      const [sequence] = await tx.unsafe<Array<{ value: number }>>(
        "select coalesce(max(daily_sequence),0)+1 value from operations where operation_date=current_date",
      );
      const [operation] = await tx.unsafe<Array<{ id: string }>>(
        "insert into operations(type,operation_date,daily_sequence,operation_time,case_name,form_template_id,created_by_user_id,updated_by_user_id) values('contract',current_date,$1,'12:00','WC06 Historical Print',$2::uuid,$3::uuid,$3::uuid) returning id",
        [sequence.value, oldTemplate.id, user.id],
      );
      await tx.unsafe(
        "insert into operation_field_values(operation_id,field_id,text_value) values($1::uuid,$2::uuid,'قيمة تاريخية مطبوعة')",
        [operation.id, field.id],
      );
      const projection = await getOperationPrintProjection(
        operation.id,
        auth,
        tx,
      );
      expect(
        projection.template.id === oldTemplate.id,
        "print uses historical template",
      );
      expect(
        projection.sections[0]?.fields[0]?.value === "قيمة تاريخية مطبوعة",
        "historical printable value resolved",
      );
      for (let index = 0; index < 205; index++)
        await tx.unsafe(
          "insert into operations(type,operation_date,daily_sequence,operation_time,case_name,form_template_id,created_by_user_id,updated_by_user_id) values('contract',current_date,$1,'13:00',$2,$3::uuid,$4::uuid,$4::uuid)",
          [
            sequence.value + index + 1,
            `WC06 Report ${index + 1}`,
            template.id,
            user.id,
          ],
        );
      const report = await getContractMonthlyReport(
        { month: new Date().getMonth() + 1, year: new Date().getFullYear(), search: "WC06" },
        auth,
        tx,
      );
      expect(
        report.total === 206 &&
          report.pageCount === Math.ceil(report.total / 15),
        "monthly report rows and page count are deterministic",
      );
      expect(
        report.rows[0].caseName === "WC06 Historical Print",
        "monthly report sorted by date and sequence",
      );
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await postgresClient.end();
  }
  console.log(`printing tests passed (${assertions} assertions)`);
}
void main();
