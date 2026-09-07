import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { apiError, operationError, requestId } from "@/lib/operations/api";
import { setLithotripsySessionState } from "@/lib/accounting/lithotripsy-sessions";
export const runtime="nodejs";
export async function PATCH(request:Request,{params}:{params:Promise<{sessionId:string}>}){const id=requestId();try{const auth=await requirePermission("accounting.lithotripsy.pricing.manage");const parsed=z.object({action:z.enum(["archive","restore"])}).safeParse(await request.json().catch(()=>null));if(!parsed.success)return apiError(400,"LITHO_SESSION_ACTION_INVALID","إجراء الجلسة غير صالح.",id);return NextResponse.json({session:await setLithotripsySessionState((await params).sessionId,parsed.data.action,auth.user.id)});}catch(error){return operationError(error,id)}}
