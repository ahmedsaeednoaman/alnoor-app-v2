"use client";
import type { BuilderField, BuilderTemplate } from "./work-form-types";
import { fieldTypeLabels } from "./work-form-rendering";
function PreviewControl({ field }: { field: BuilderField }) {
  if (field.fieldType === "textarea") return <textarea disabled placeholder={field.description ?? "اكتب هنا..."} />;
  if (field.fieldType === "boolean") return <div className="builder-preview__boolean"><span /> نعم <span /> لا</div>;
  if (field.fieldType === "smart_multi") return <div className="builder-preview__smart"><i>عنصر مختار ×</i><span>ابحث واختر...</span></div>;
  if (field.fieldType === "smart_single" || field.fieldType === "select") return <div className="builder-preview__select">اختر من القائمة <b>⌄</b></div>;
  return <input disabled type={field.fieldType === "money" || field.fieldType === "number" ? "number" : field.fieldType} placeholder={fieldTypeLabels[field.fieldType]} />;
}
export function WorkFormPreview({ template }: { template: BuilderTemplate }) {
  return <section className="work-form-preview" aria-label="معاينة النموذج">
    <header><div><span>معاينة مباشرة · مسودة v{template.version}</span><h3>{template.name}</h3></div><small>لا تُنشئ هذه المعاينة عملية فعلية</small></header>
    {template.sections.filter(section => !section.archivedAt).map(section => <div className="builder-preview__section" key={section.id}>
      <h4>{section.label}</h4>{section.description && <p>{section.description}</p>}
      <div className="builder-preview__grid">{section.fields.filter(field => !field.archivedAt && field.showInForm).map(field => <label key={field.id}>
        <span>{field.label}{field.required ? <b aria-label="إلزامي">*</b> : <small>اختياري</small>}</span>
        <PreviewControl field={field} />
      </label>)}</div>
      {!section.fields.some(field => !field.archivedAt && field.showInForm) && <p className="builder-empty">لا توجد حقول ظاهرة في هذا القسم.</p>}
    </div>)}
  </section>;
}
