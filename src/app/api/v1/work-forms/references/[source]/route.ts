import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth/guards";
import { apiError, operationError, requestId } from "@/lib/operations/api";
import { postgresClient } from "@/db/client";
import { resolveSmartDropdownSource } from "@/lib/work-forms/registry";
import { smartDropdownSources, type SmartDropdownSource } from "@/lib/work-forms/types";

export const runtime="nodejs";
export async function GET(_request:Request,{params}:{params:Promise<{source:string}>}){
 const id=requestId();try{await requireAnyPermission(["operations.create","accounting.lithotripsy.pricing.manage"]);const source=(await params).source;if(!smartDropdownSources.includes(source as SmartDropdownSource))return apiError(400,"SMART_SOURCE_INVALID","مصدر القائمة غير صالح.",id);const definition=resolveSmartDropdownSource(source as SmartDropdownSource);const items=await postgresClient.unsafe<Array<{id:string;name:string}>>(`SELECT id,${definition.labelColumn} AS name FROM "${definition.table}" WHERE ${definition.active} ORDER BY ${definition.labelColumn} LIMIT 100`);return NextResponse.json({items});}catch(error){return operationError(error,id)}
}
