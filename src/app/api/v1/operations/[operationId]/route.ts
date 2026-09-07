import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guards";
import { apiError, operationError, requestId } from "@/lib/operations/api";
import { getDynamicOperationDetails, updateDynamicOperation } from "@/lib/operations/details";
import { dynamicOperationPatchSchema } from "@/lib/operations/validation";
export const runtime="nodejs";
export async function GET(_request:Request,{params}:{params:Promise<{operationId:string}>}){const id=requestId();try{const auth=await requirePermission("operations.view");const {operationId}=await params;const includeFinance=auth.user.permissions.includes("accounting.finance.view");return NextResponse.json(await getDynamicOperationDetails(operationId,auth.user,includeFinance));}catch(e){return operationError(e,id)}}
export async function PATCH(request:Request,{params}:{params:Promise<{operationId:string}>}){const id=requestId();try{const auth=await requirePermission("operations.view");const parsed=dynamicOperationPatchSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return apiError(400,"VALIDATION_ERROR","يرجى مراجعة بيانات العملية.",id,parsed.error.flatten());await updateDynamicOperation((await params).operationId,parsed.data,auth.user);return NextResponse.json({ok:true});}catch(e){return operationError(e,id)}}
