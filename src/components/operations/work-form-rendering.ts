import type { DynamicFieldValue, FieldType, SmartDropdownSource } from "@/lib/work-forms/types";
import type { BuilderField, BuilderTemplate } from "./work-form-types";

export type WorkFormValues=Record<string,DynamicFieldValue>;
export const fieldTypeLabels:Record<FieldType,string>={text:"نص قصير",textarea:"نص طويل",number:"رقم",money:"قيمة مالية",date:"تاريخ",time:"وقت",boolean:"نعم / لا",select:"قائمة اختيارات",smart_single:"قائمة ذكية",smart_multi:"قائمة ذكية متعددة"};
export const sourceCatalogType:Record<SmartDropdownSource,string>={doctors:"doctors",hospitals:"hospitals",procedures:"procedures",equipment:"equipment",consumables:"consumables",stents:"stents",anesthesiologists:"anesthesiologists",technicians:"technicians",contract_entities:"contract-entities",anesthesia_types:"anesthesia-types",users:"users"};
export const selectOptions=(field:BuilderField)=>field.stableKey==="side"?[{value:"right",label:"يمين"},{value:"left",label:"يسار"},{value:"bilateral",label:"جانبان"}]:[];
export function initialWorkFormValues(template:BuilderTemplate):WorkFormValues {
 const values:WorkFormValues={};const today=new Date().toISOString().slice(0,10);
 for(const section of template.sections)for(const field of section.fields){if(field.archivedAt||!field.showInForm)continue;values[field.stableKey]=field.multiple?[]:field.stableKey==="operation_date"?today:field.stableKey==="operation_time"?"09:00":field.stableKey==="session_count"?1:null}
 return values;
}
export function validateWorkFormClient(template:BuilderTemplate,values:WorkFormValues){const errors:Record<string,string>={};for(const section of template.sections)for(const field of section.fields){if(field.archivedAt||!field.showInForm)continue;const value=values[field.stableKey];const missing=value==null||value===""||(Array.isArray(value)&&value.length===0);if(field.required&&missing)errors[field.stableKey]=`${field.label} مطلوب.`;if(Array.isArray(value)){const minimum=field.required?Math.max(1,field.minSelections??0):field.minSelections??0;if(value.length<minimum)errors[field.stableKey]=`الحد الأدنى للاختيارات هو ${minimum}.`;if(field.maxSelections!=null&&value.length>field.maxSelections)errors[field.stableKey]=`الحد الأقصى للاختيارات هو ${field.maxSelections}.`}}return errors}
