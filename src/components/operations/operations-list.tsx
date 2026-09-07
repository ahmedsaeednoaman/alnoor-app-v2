/* eslint-disable react-hooks/set-state-in-effect */
"use client";
import Link from "next/link";
import { CompactMonthFilter } from "@/components/pagination/compact-month-filter";
import { BottomPagination } from "@/components/pagination/bottom-pagination";
import { useSearchParams } from "next/navigation";
import { canonicalOperationsQuery, operationsMonthQuery, operationsCustomRangeQuery, operationsPageCorrection, updateOperationsQuery } from "@/lib/operations/list-query";
import { monthlyPageSize, isSupportedMonth, type CalendarMonth } from "@/lib/pagination/monthly";
import type { TaxInvoice } from "@/lib/operations/tax-invoice";
import { OperationTaxInvoiceModal } from "./operation-tax-invoice-modal";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OperationDetails as DynamicOperationDetails } from "./operation-details";
import { SmartSelect } from "./smart-select";

export type OperationalReviewItem={id:string;type:"lithotripsy"|"endoscopy"|"contract";status:string;operationDate:string;dailySequence:number;operationTime:string;caseName:string|null;doctorId:string|null;doctorName:string|null;hospitalId:string|null;hospitalName:string|null;contractEntityId:string|null;contractEntityName:string|null;referenceNumber:string|null;side:"right"|"left"|"bilateral"|null;sessionCount:number|null;procedures:string[];equipment:string[];createdByName:string|null;hasNotes:boolean;employeeEditWindow:boolean;taxInvoice?:TaxInvoice|null};
type ReviewGroup={id:string;label:string;secondaryLabel:string|null;firstTime:string;operations:OperationalReviewItem[]};
export type OperationalReviewTypeGroup={type:OperationalReviewItem["type"];groups:ReviewGroup[]};
export type OperationalReviewDay={date:string;count:number;types:OperationalReviewTypeGroup[]};
const typeOrder:OperationalReviewItem["type"][]=["lithotripsy","endoscopy","contract"];
const typeLabels={lithotripsy:"التفتيت",endoscopy:"المناظير",contract:"التعاقد"};
const typeEmpty={lithotripsy:"لا توجد حالات تفتيت في الفترة المحددة",endoscopy:"لا توجد حالات مناظير في الفترة المحددة",contract:"لا توجد حالات تعاقد في الفترة المحددة"};
const operationSort=(a:OperationalReviewItem,b:OperationalReviewItem)=>a.operationTime.localeCompare(b.operationTime)||a.dailySequence-b.dailySequence||a.id.localeCompare(b.id);
function grouped(operations:OperationalReviewItem[],keyOf:(operation:OperationalReviewItem)=>string,labelOf:(operation:OperationalReviewItem)=>string,secondaryOf:(operation:OperationalReviewItem)=>string|null=()=>null){const map=new Map<string,ReviewGroup>();for(const operation of operations){const id=keyOf(operation),group=map.get(id)??{id,label:labelOf(operation),secondaryLabel:secondaryOf(operation),firstTime:operation.operationTime,operations:[]};group.operations.push(operation);if(operation.operationTime<group.firstTime)group.firstTime=operation.operationTime;map.set(id,group)}return[...map.values()].map(group=>({...group,operations:group.operations.sort(operationSort)})).sort((a,b)=>a.firstTime.localeCompare(b.firstTime)||a.label.localeCompare(b.label,"ar"))}
export function groupOperationalReview(items:OperationalReviewItem[]):OperationalReviewDay[]{const days=new Map<string,OperationalReviewItem[]>();for(const item of items)days.set(item.operationDate,[...(days.get(item.operationDate)??[]),item]);return[...days.entries()].sort(([a],[b])=>b.localeCompare(a)).map(([date,dayItems])=>({date,count:dayItems.length,types:typeOrder.map((type):OperationalReviewTypeGroup|null=>{const operations=dayItems.filter(item=>item.type===type);if(!operations.length)return null;const groups=type==="contract"?grouped(operations,item=>item.hospitalId??"no-hospital",item=>item.hospitalName||"بدون مستشفى محدد").map(group=>({...group,secondaryLabel:[...new Set(group.operations.map(item=>item.contractEntityName||"بدون جهة تعاقد محددة"))].join(" • ")})):grouped(operations,item=>item.doctorId??"no-doctor",item=>item.doctorName||"بدون طبيب محدد");return{type,groups}}).filter((value):value is OperationalReviewTypeGroup=>value!==null)}))}

const dayFormatter=new Intl.DateTimeFormat("ar-EG",{weekday:"long",day:"numeric",month:"long",year:"numeric",timeZone:"Africa/Cairo"});
const countLabel=(count:number)=>count===1?"حالة واحدة":count===2?"حالتان":`${count} حالات`;

export function OperationsList({canEditAll,isEmployee,canCreateInvoice=false,defaultMonth}:{canEditAll:boolean;isEmployee:boolean;canCreateInvoice?:boolean;defaultMonth:CalendarMonth}){
 const params=useSearchParams(), queryString=params.toString();
 const type=params.get("type")||"", doctor=params.get("doctorId")||"", hospital=params.get("hospitalId")||"", search=params.get("search")||"", invoiceStatus=params.get("invoiceStatus")||"all";
 const[items,setItems]=useState<OperationalReviewItem[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(""),[detailId,setDetailId]=useState<string|null>(null),[invoiceOperation,setInvoiceOperation]=useState<OperationalReviewItem|null>(null),[showFilters,setShowFilters]=useState<boolean|null>(null);
 const[pagination,setPagination]=useState({page:1,pageSize:25,total:0,totalPages:0,hasNext:false,hasPrevious:false});
 const requestVersion=useRef(0);
 const[range,setRange]=useState({from:"",to:""});
 const[dateDraft,setDateDraft]=useState<{query:string;from:string;to:string}|null>(null);
 const dateAnchor=(params.get("from")||params.get("date")||"").split("-").map(Number);
 const candidateMonth={year:Number(params.get("year"))||dateAnchor[0]||defaultMonth.year,month:Number(params.get("month"))||dateAnchor[1]||defaultMonth.month};
 const selectedMonth=isSupportedMonth(candidateMonth)?candidateMonth:defaultMonth;
 const isMonthScope=params.get("period")==="month";
 const navigateMonth=(month:CalendarMonth)=>{if(isSupportedMonth(month)){setDateDraft(null);window.history.replaceState(null,"",`?${operationsMonthQuery(window.location.search,month)}${window.location.hash}`)}};
 const update=(changes:Record<string,string>)=>window.history.replaceState(null,"",`?${canonicalOperationsQuery(updateOperationsQuery(window.location.search,changes),defaultMonth)}`);
 const load=useCallback(async(signal?:AbortSignal)=>{const version=++requestVersion.current;setLoading(true);try{const response=await fetch(`/api/v1/operations?${queryString}`,{signal});const data=await response.json();if(signal?.aborted||version!==requestVersion.current)return;if(!response.ok)throw new Error(data.error?.message||"تعذر تحميل العمليات");if(new URLSearchParams(window.location.search).toString()!==queryString)return;const correction=operationsPageCorrection(queryString,data.pagination);if(correction){window.history.replaceState(null,"",`?${correction}${window.location.hash}`);return}setItems(data.operations);setPagination(data.pagination);setRange({from:data.filters.from||"",to:data.filters.to||""});setError("")}catch(error){if(!signal?.aborted&&version===requestVersion.current)setError(error instanceof Error?error.message:"تعذر تحميل العمليات")}finally{if(!signal?.aborted&&version===requestVersion.current)setLoading(false)}},[queryString,setItems,setPagination,setRange,setError,setLoading]);
 useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort()},[load]);
 useEffect(()=>{const id=window.location.hash.slice(1);if(id)setDetailId(id)},[]);
 const days=useMemo(()=>{const result=new Map<string,OperationalReviewItem[]>();for(const item of items)result.set(item.operationDate,[...(result.get(item.operationDate)??[]),item]);return[...result.entries()].sort(([a],[b])=>b.localeCompare(a)).map(([date,operations])=>({date,operations:invoiceStatus==="latest"?operations:operations.sort((a,b)=>b.operationTime.localeCompare(a.operationTime)||b.dailySequence-a.dailySequence)}))},[items,invoiceStatus]);
 const activeDraft=dateDraft?.query===queryString?dateDraft:null;
 const from=activeDraft?.from??params.get("from")??range.from,to=activeDraft?.to??params.get("to")??range.to;
 const changeDate=(key:"from"|"to",value:string)=>{
   const next={from,to,[key]:value};
   setDateDraft({query:queryString,...next});
   if(next.from&&next.to&&next.from<=next.to){window.history.replaceState(null,"",`?${operationsCustomRangeQuery(window.location.search,next.from,next.to)}`);setDateDraft(null)}
 };
 const activeCount=[search.trim(),doctor,hospital,type,invoiceStatus!=="all",Boolean(params.get("from")||params.get("date")||params.get("period")&&params.get("period")!=="month"||isMonthScope&&(selectedMonth.year!==defaultMonth.year||selectedMonth.month!==defaultMonth.month))].filter(Boolean).length;
 const toggleFilters=()=>setShowFilters(current=>!(current??window.matchMedia("(min-width: 768px)").matches));
 return <div className="operations-page" dir="rtl"><header className="operations-hero"><div><span>السجل التشغيلي</span><h2>العمليات</h2><p>استعراض الحالات المسجلة وفتح تفاصيل كل حالة.</p></div><Link href="/operations/new">+ إضافة شغل</Link></header>
 <div className="operation-segments" role="tablist" aria-label="نوع العمليات">{[["","الكل"],["lithotripsy","التفتيت"],["endoscopy","المناظير"],["contract","التعاقد"]].map(([value,label])=><button role="tab" aria-selected={type===value} className={type===value?"active":""} onClick={()=>update({type:value})} key={value}>{label}</button>)}</div>
 <div className="operations-filter-toggle"><CompactMonthFilter year={selectedMonth.year} month={selectedMonth.month} monthlyScope={params.get("period")==="month"} onMonthChange={navigateMonth}/>{showFilters===null?<><button className="operations-toggle-desktop" aria-expanded="true" aria-controls="operations-filter-panel" onClick={toggleFilters}>⌕ تصفية الفلاتر{activeCount>0?` (${activeCount})`:""}</button><button className="operations-toggle-mobile" aria-expanded="false" aria-controls="operations-filter-panel" onClick={toggleFilters}>⌕ تصفية الفلاتر{activeCount>0?` (${activeCount})`:""}</button></>:<button aria-expanded={showFilters} aria-controls="operations-filter-panel" onClick={toggleFilters}>⌕ تصفية الفلاتر{activeCount>0?` (${activeCount})`:""}</button>}</div>
 <section id="operations-filter-panel" className={`operation-filters operations-list-filters ${showFilters===null?"responsive-default":showFilters?"is-open":"is-closed"}`}>
 <div className="operation-grid"><label>البحث<input value={search} onChange={event=>update({search:event.target.value})} placeholder="اسم الحالة أو الرقم الموحد"/></label><label>من<input type="date" disabled={loading} value={from} onChange={event=>changeDate("from",event.target.value)}/></label><label>إلى<input type="date" disabled={loading} value={to} onChange={event=>changeDate("to",event.target.value)}/></label><SmartSelect label="الطبيب" type="doctors" value={doctor} onChange={value=>update({doctorId:value as string})} canManage={false}/><SmartSelect label="المستشفى" type="hospitals" value={hospital} onChange={value=>update({hospitalId:value as string})} canManage={false}/><label>حالة الفاتورة<select value={invoiceStatus} onChange={event=>update({invoiceStatus:event.target.value})}><option value="all">الكل</option><option value="pending">فواتير معلقة</option><option value="completed">فواتير مكتملة</option><option value="latest">أحدث فاتورة مُصدرة</option></select></label></div>
 {activeDraft&&<small role="status">{!from||!to?"أكمل بداية ونهاية الفترة لتطبيقها.":"نهاية الفترة يجب ألا تسبق بدايتها."}</small>}
 <button type="button" onClick={()=>{setDateDraft(null);navigateMonth(defaultMonth)}}>الفترة الافتراضية — الشهر الحالي</button></section>
 {loading&&<small role="status">جارٍ تحديث النتائج…</small>}
 {error?<p className="operations-state error" role="alert">{error}</p>:!items.length&&!loading?<p className="operations-state">{type?typeEmpty[type as keyof typeof typeEmpty]:"لا توجد عمليات في الفترة المحددة"}</p>:days.map(day=><section className="operations-day" key={day.date}><header><h3>{dayFormatter.format(new Date(`${day.date}T12:00:00Z`))}</h3><span>{countLabel(day.operations.length)}</span></header><div className="operation-timeline">{day.operations.map(operation=><article className="operations-list-row" key={operation.id}>
 <div className="operations-row-identity"><div className="operations-row-heading"><b>#{operation.dailySequence}</b><time>{operation.operationTime}</time></div><strong>{operation.caseName?.trim()||"بدون اسم حالة"}</strong></div>
 <div className="operations-row-details">
   <span className="operations-row-type">{typeLabels[operation.type]}</span>
   <span className="operations-row-field"><small className="operations-row-label">الطبيب</small><span className="operations-row-value">{operation.doctorName}</span></span>
   <span className="operations-row-field"><small className="operations-row-label">المستشفى</small><span className="operations-row-value">{operation.hospitalName}</span></span>
 </div>
 <div className="operations-row-invoice">{operation.taxInvoice?<span className="operations-invoice-complete">✓ {operation.taxInvoice.registryLabel} <bdi>{operation.taxInvoice.invoiceNumber}</bdi></span>:<>{operation.type==="contract"&&<span className="operations-invoice-pending">● لم تصدر فاتورة</span>}{canCreateInvoice&&<button type="button" onClick={()=>setInvoiceOperation(operation)}>{operation.type==="contract"?"إصدار فاتورة":"+ فاتورة"}</button>}</>}</div>
 <div className="operations-row-actions"><button type="button" onClick={()=>setDetailId(operation.id)}>فتح الحالة</button>{(isEmployee?operation.employeeEditWindow:canEditAll)&&<Link href={`/operations/${operation.id}/edit`}>تعديل</Link>}</div>
 </article>)}</div></section>)}
 <BottomPagination page={Number(params.get("page")) || 1} pageSize={monthlyPageSize(params.get("pageSize"))} total={pagination.total} totalPages={pagination.totalPages} hasNext={pagination.hasNext} hasPrevious={pagination.hasPrevious} loading={loading} monthlyScope={params.get("period")==="month"} onPageChange={page=>update({page:String(page)})} onPageSizeChange={size=>update({pageSize:String(size)})}/>
 {invoiceOperation&&<OperationTaxInvoiceModal operation={invoiceOperation} onClose={()=>setInvoiceOperation(null)} onSaved={invoice=>{setItems(current=>current.map(item=>item.id===invoiceOperation.id?{...item,taxInvoice:invoice}:item));setInvoiceOperation(null);void load()}}/>}
 {detailId&&<DynamicOperationDetails operationId={detailId} onClose={()=>{setDetailId(null);history.replaceState(null,"",location.pathname+location.search)}} onRefresh={()=>void load()}/>}</div>
}
