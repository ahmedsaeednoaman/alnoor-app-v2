import { NextResponse } from "next/server";
import { pushActor, pushBody, pushError, PushError } from "@/lib/push/api";
import { sessionSubscriptions } from "@/lib/push/store";
import { sendSelfTest, vapidConfiguration } from "@/lib/push/server";
export const runtime = "nodejs";
// Self-only, fixed-payload diagnostic. Per-process cooldown; no broadcast or targeting input.
const cooldown = new Map<string, number>();
export async function POST(request: Request) {
  try {
    const actor = await pushActor(request, true);
    const body = await pushBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) throw new PushError(400, "لا يقبل الاختبار بيانات مستلم.");
    if (!vapidConfiguration()) throw new PushError(503, "إعداد الإشعارات غير مكتمل");
    const now = Date.now();
    for (const [key, until] of cooldown) if (until <= now) cooldown.delete(key);
    if (cooldown.has(actor.user.id)) throw new PushError(429, "انتظر دقيقة قبل إعادة الاختبار.");
    cooldown.set(actor.user.id, now + 60_000);
    const rows = await sessionSubscriptions(actor);
    if (!rows.length) throw new PushError(409, "فعّل الإشعارات لهذه الجلسة أولاً.");
    const results = await Promise.all(rows.map(row => sendSelfTest(actor, row)));
    return NextResponse.json({ accepted: results.filter(r => r === "accepted").length, expired: results.filter(r => r === "expired").length, failed: results.filter(r => r !== "accepted" && r !== "expired").length });
  } catch (error) { return pushError(error); }
}
