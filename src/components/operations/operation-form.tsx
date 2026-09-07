"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { WorkFormBuilder } from "./work-form-builder";
import { WorkFormPreview } from "./work-form-preview";
import { WorkFormRenderer } from "./work-form-renderer";
import { initialWorkFormValues, validateWorkFormClient, type WorkFormValues } from "./work-form-rendering";
import type { BuilderTemplate } from "./work-form-types";
import type { OperationType } from "@/lib/work-forms/types";

const typeOptions:[OperationType,string][]=[["lithotripsy","تفتيت"],["endoscopy","مناظير"],["contract","تعاقد"]];
export function OperationForm({canManageCatalogs,canManageWorkForms}:{canManageCatalogs:boolean;canManageWorkForms:boolean}){
 const router=useRouter();
 const [type,setType]=useState<OperationType>("lithotripsy"),[template,setTemplate]=useState<BuilderTemplate|null>(null),[values,setValues]=useState<WorkFormValues>({}),[fieldErrors,setFieldErrors]=useState<Record<string,string>>({});
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [builderOpen,setBuilderOpen]=useState(false),[preview,setPreview]=useState<BuilderTemplate|null>(null),[hasDraft,setHasDraft]=useState(false);
 const updatePreview=useCallback((value:BuilderTemplate|null)=>setPreview(value),[]);
 const dirty=useMemo(()=>template?JSON.stringify(values)!==JSON.stringify(initialWorkFormValues(template)):false,[template,values]);
 useEffect(()=>{const controller=new AbortController();queueMicrotask(()=>{if(controller.signal.aborted)return;fetch(`/api/v1/work-forms/${type}`,{signal:controller.signal}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error?.message??"تعذر تحميل نموذج العمل.");const next=body.template as BuilderTemplate;setTemplate(next);setValues(initialWorkFormValues(next));setFieldErrors({})}).catch(reason=>{if(reason.name!=="AbortError")setError(reason.message??"تعذر تحميل نموذج العمل.")}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})});return()=>controller.abort()},[type]);
 function changeType(next:OperationType){if(next===type)return;if(dirty&&!confirm("سيتم فقد البيانات المدخلة لهذا النموذج. متابعة؟"))return;setBuilderOpen(false);setPreview(null);setHasDraft(false);setLoading(true);setError("");setTemplate(null);setType(next)}
 function adoptPublished(next:BuilderTemplate){setTemplate(next);setValues(initialWorkFormValues(next));setFieldErrors({});setPreview(null);setHasDraft(false)}
 async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();if(!template)return;const errors=validateWorkFormClient(template,values);setFieldErrors(errors);if(Object.keys(errors).length){setError("يرجى استكمال الحقول الموضحة.");return}setBusy(true);setError("");const response=await fetch("/api/v1/operations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operationType:type,formTemplateId:template.id,values})});const body=await response.json();setBusy(false);if(!response.ok){setError(body.error?.message??"تعذر حفظ العملية");return}router.push("/operations");router.refresh()}
 function reset(){if(dirty&&!confirm("هل تريد مسح البيانات المدخلة؟"))return;if(template){setValues(initialWorkFormValues(template));setFieldErrors({});setError("")}}
 return <><form className="operation-form" onSubmit={submit}><header className="operations-hero"><div><span>سجل التشغيل</span><h2>إضافة شغل</h2><p>سجّل ما حدث ميدانياً، وتُستكمل القيم المالية لاحقاً بواسطة الحسابات.</p></div>{template&&<small className="published-version">النموذج المنشور v{template.version}</small>}</header>
 <div className="work-form-toolbar"><div className="operation-segments" role="tablist">{typeOptions.map(([id,label])=><button type="button" role="tab" className={type===id?"active":""} aria-selected={type===id} onClick={()=>changeType(id)} key={id}>{label}</button>)}</div>{canManageWorkForms&&<button className="work-form-settings-button" type="button" onClick={()=>setBuilderOpen(true)}>⚙ إعدادات النموذج {hasDraft&&<small>يوجد مسودة غير منشورة</small>}</button>}</div>
 {preview&&<WorkFormPreview template={preview}/>} {loading?<div className="dynamic-form-loading" aria-live="polite"><i/><i/><i/><p>جاري تحميل نموذج العمل...</p></div>:template?<WorkFormRenderer template={template} values={values} errors={fieldErrors} canManageCatalogs={canManageCatalogs} onChange={(key,value)=>{setValues(current=>({...current,[key]:value}));setFieldErrors(current=>{const next={...current};delete next[key];return next})}}/>:<div className="operation-error">{error||"تعذر تحميل نموذج العمل."}</div>}
 {error&&template&&<p className="operation-error" role="alert">{error}</p>}<footer className="operation-actions"><button disabled={busy||loading||!template} className="primary" type="submit">{busy?"جاري الحفظ...":"حفظ العملية"}</button><button disabled={busy||!template} type="button" onClick={reset}>إعادة ضبط</button><button type="button" onClick={()=>router.back()}>إلغاء</button></footer></form>
 {builderOpen&&canManageWorkForms&&<WorkFormBuilder type={type} onTypeChange={next=>{setLoading(true);setTemplate(null);setType(next);setPreview(null)}} onPublished={adoptPublished} onClose={()=>{setBuilderOpen(false);setPreview(null)}} onPreview={updatePreview} onDraftExists={()=>setHasDraft(true)}/>}</>;
}
