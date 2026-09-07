import { NextResponse } from "next/server";
import { requireAuthenticatedUser, AuthenticationRequiredError } from "@/lib/auth/guards";
import { isPushEligible } from "./validation";

export class PushError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export async function pushActor(request: Request, mutation = false) {
  const actor = await requireAuthenticatedUser();
  if (!isPushEligible(actor.user)) throw new PushError(403, "ليس لديك صلاحية استخدام الإشعارات.");
  if (mutation && request.headers.get("origin") !== new URL(request.url).origin) throw new PushError(403, "مصدر الطلب غير مسموح.");
  return actor;
}
export function pushError(error: unknown) {
  const status = error instanceof AuthenticationRequiredError ? 401 : error instanceof PushError ? error.status : 500;
  // Provider errors and database errors may contain subscription secrets. Never echo/log them.
  return NextResponse.json({ error: { message: error instanceof PushError ? error.message : status === 401 ? "يجب تسجيل الدخول أولاً." : "تعذر إكمال طلب الإشعارات." } }, { status, headers: { "Cache-Control": "no-store" } });
}
export async function pushBody(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new PushError(400, "صيغة الطلب غير صحيحة.");
  const reader = request.body?.getReader();
  if (!reader) throw new PushError(400, "بيانات الطلب مطلوبة.");
  let text = "", size = 0;
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > 8192) { await reader.cancel(); throw new PushError(413, "حجم الطلب غير مسموح."); }
    text += decoder.decode(value, { stream: true });
  }
  try { return JSON.parse(text + decoder.decode()); } catch { throw new PushError(400, "صيغة الطلب غير صحيحة."); }
}
