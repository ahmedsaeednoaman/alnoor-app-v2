import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { apiError, operationError, requestId } from "@/lib/operations/api";
import { createLithotripsySession, listLithotripsySessions } from "@/lib/accounting/lithotripsy-sessions";
export const runtime = "nodejs";
export async function GET(request: Request) { const id=requestId(); try { await requirePermission("operations.view"); const includeArchived=new URL(request.url).searchParams.get("includeArchived")==="true"; return NextResponse.json({sessions:await listLithotripsySessions({includeArchived})}); } catch(error){ return operationError(error,id); } }
export async function POST(request: Request) { const id=requestId(); try { const auth=await requirePermission("accounting.lithotripsy.pricing.manage"); const parsed=z.object({name:z.string().trim().min(2).max(180)}).safeParse(await request.json().catch(()=>null)); if(!parsed.success)return apiError(400,"LITHO_SESSION_INPUT_INVALID","اسم الجلسة مطلوب.",id); return NextResponse.json({session:await createLithotripsySession(parsed.data.name,auth.user.id)},{status:201}); } catch(error){ return operationError(error,id); } }
