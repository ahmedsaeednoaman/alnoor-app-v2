import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guards";
import { apiError, operationError, requestId } from "@/lib/operations/api";
import { listOperations } from "@/lib/operations/service";
import { createDynamicOperation } from "@/lib/operations/dynamic";
import { dynamicOperationInputSchema, operationFilterSchema } from "@/lib/operations/validation";
export const runtime="nodejs";
export async function GET(request:Request){const id=requestId();try{const auth=await requirePermission("operations.view");const parsed=operationFilterSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));if(!parsed.success)return apiError(400,"VALIDATION_ERROR","معاملات البحث غير صحيحة.",id,parsed.error.flatten());return NextResponse.json(await listOperations(parsed.data,auth.user));}catch(e){return operationError(e,id)}}
export async function POST(request:Request){const id=requestId();try{const auth=await requirePermission("operations.create");const parsed=dynamicOperationInputSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return apiError(400,"VALIDATION_ERROR","يرجى مراجعة بيانات العملية.",id,parsed.error.flatten());const operation=await createDynamicOperation(parsed.data,auth.user);return NextResponse.json({operation},{status:201});}catch(e){return operationError(e,id)}}
