"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { WorkFormBuilder } from "./work-form-builder";
import { WorkFormPreview } from "./work-form-preview";
import { WorkFormRenderer } from "./work-form-renderer";
import { initialWorkFormValues, validateWorkFormClient, type WorkFormValues } from "./work-form-rendering";
import type { BuilderTemplate } from "./work-form-types";
import type { OperationType } from "@/lib/work-forms/types";

import { usePublishedTemplate } from "@/lib/work-forms/published-template-cache";

const typeOptions:[OperationType,string][]=[["lithotripsy","تفتيت"],["endoscopy","مناظير"],["contract","تعاقد"]];
export function OperationForm({canManageCatalogs,canManageWorkForms}:{canManageCatalogs:boolean;canManageWorkForms:boolean}){
 const router=useRouter();
 const [type,setType]=useState<OperationType>("lithotripsy"),[template,setTemplate]=useState<BuilderTemplate|null>(null),[values,setValues]=useState<WorkFormValues>({}),[fieldErrors,setFieldErrors]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const [builderOpen,setBuilderOpen]=useState(false),[preview,setPreview]=useState<BuilderTemplate|null>(null),[hasDraft,setHasDraft]=useState(false);
 const updatePreview=useCallback((value:BuilderTemplate|null)=>setPreview(value),[]);
 const dirty=useMemo(()=>template?JSON.stringify(values)!==JSON.stringify(initialWorkFormValues(template)):false,[template,values]);
 const published=usePublishedTemplate(type);
 const currentRequest=useRef(published.key);
 useEffect(()=>{currentRequest.current=published.key},[published.key]);
 // Pin the first usable schema for this form. Revalidation only updates SWR;
 // it never replaces the template or resets entered values in an open form.
 useEffect(()=>{
  if(template||!published.data||published.data.operationType!==type)return;
  const next=published.data;let active=true;
  queueMicrotask(()=>{if(active){setTemplate(next);setValues(initialWorkFormValues(next));setFieldErrors({})}});
  return()=>{active=false};
 },[template,published.data,type]);
 const renderTemplate=published.data&&template?.operationType===type?template:null;
 const loading=!renderTemplate&&!published.error;
 const loadError=published.error?"تعذر تحميل نموذج العمل.":"";
 function changeType(next:OperationType){if(next===type)return;if(dirty&&!confirm("سيتم فقد البيانات المدخلة لهذا النموذج. متابعة؟"))return;setBuilderOpen(false);setPreview(null);setHasDraft(false);setError("");setTemplate(null);setType(next)}
 function adoptPublished(next:BuilderTemplate){if(next.operationType!==type||!published.key||currentRequest.current!==published.key)return;published.invalidatePublished();setTemplate(next);setValues(initialWorkFormValues(next));setFieldErrors({});setPreview(null);setHasDraft(false)}
 async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();if(!template||!renderTemplate)return;const errors=validateWorkFormClient(template,values);setFieldErrors(errors);if(Object.keys(errors).length){setError("يرجى استكمال الحقول الموضحة.");return}setBusy(true);setError("");const response=await fetch("/api/v1/operations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operationType:type,formTemplateId:template.id,values})});const body=await response.json();setBusy(false);if(!response.ok){setError(body.error?.message??"تعذر حفظ العملية");return}router.push("/operations");router.refresh()}
 function reset(){if(dirty&&!confirm("هل تريد مسح البيانات المدخلة؟"))return;if(template){setValues(initialWorkFormValues(template));setFieldErrors({});setError("")}}
 return <><form className="operation-form" onSubmit={submit}>
 <div className="work-form-toolbar"><div className="operation-segments" role="tablist">{typeOptions.map(([id,label])=><button type="button" role="tab" className={type===id?"active":""} aria-selected={type===id} onClick={()=>changeType(id)} key={id}>{label}</button>)}</div>{canManageWorkForms&&<button className="work-form-settings-button" type="button" onClick={()=>setBuilderOpen(true)}>⚙ إعدادات النموذج {hasDraft&&<small>يوجد مسودة غير منشورة</small>}</button>}</div>
 {preview&&<WorkFormPreview template={preview}/>} {loading?<div className="dynamic-form-loading" aria-live="polite"><i/><i/><i/><p>جاري تحميل نموذج العمل...</p></div>:renderTemplate?<WorkFormRenderer template={renderTemplate} values={values} errors={fieldErrors} canManageCatalogs={canManageCatalogs} onChange={(key,value)=>{setValues(current=>({...current,[key]:value}));setFieldErrors(current=>{const next={...current};delete next[key];return next})}}/>:<div className="operation-error">{error||loadError||"تعذر تحميل نموذج العمل."}</div>}
 {(error||loadError)&&renderTemplate&&<p className="operation-error" role="alert">{error||loadError}</p>}<footer className="operation-actions"><button disabled={busy||loading||!renderTemplate} className="primary" type="submit">{busy?"جاري الحفظ...":"حفظ العملية"}</button><button disabled={busy||!template} type="button" onClick={reset}>إعادة ضبط</button><button type="button" onClick={()=>router.back()}>إلغاء</button></footer></form>
 {builderOpen&&canManageWorkForms&&<WorkFormBuilder type={type} onTypeChange={next=>{setTemplate(null);setType(next);setPreview(null)}} onPublished={adoptPublished} onClose={()=>{setBuilderOpen(false);setPreview(null)}} onPreview={updatePreview} onDraftExists={()=>setHasDraft(true)}/>}</>;
}
