import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { apiError, operationError, requestId } from "./api";
import { setOperationArchived } from "./archive";

const archiveInput = z.object({ reason: z.string().trim().max(2000).optional() }).strict();
const restoreInput = z.object({}).strict();
export async function operationArchiveRoute(request: Request, params: Promise<{ operationId: string }>, archived: boolean) {
  const id = requestId();
  try {
    const auth = await requirePermission("operations.archive");
    const operationId = z.uuid().safeParse((await params).operationId);
    const text = await request.text();
    let body: unknown;
    try { body = text.trim() ? JSON.parse(text) : {}; } catch { body = null; }
    const input = (archived ? archiveInput : restoreInput).safeParse(body);
    if (!input.success || !operationId.success) return apiError(400, "VALIDATION_ERROR", "بيانات الأرشفة غير صحيحة.", id);
    const reason = "reason" in input.data && typeof input.data.reason === "string" ? input.data.reason || null : null;
    return NextResponse.json({ ok: true, ...await setOperationArchived(operationId.data, archived, reason, auth.user) });
  } catch (error) { return operationError(error, id); }
}
