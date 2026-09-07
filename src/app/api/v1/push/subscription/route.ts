import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { pushActor, pushBody, pushError, PushError } from "@/lib/push/api";
import { subscriptionSchema, unsubscribeSchema } from "@/lib/push/validation";
import { removeSubscription, saveSubscription, sessionSubscriptions } from "@/lib/push/store";
import { vapidConfiguration } from "@/lib/push/server";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const actor = await pushActor(request);
    const config = vapidConfiguration();
    const rows = await sessionSubscriptions(actor);
    return NextResponse.json({ configured: !!config, publicKey: config?.publicKey ?? null, endpointHashes: rows.map(row => createHash("sha256").update(row.endpoint).digest("hex")) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return pushError(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await pushActor(request, true);
    const input = subscriptionSchema.safeParse(await pushBody(request));
    if (!input.success) throw new PushError(400, "بيانات الاشتراك غير صحيحة.");
    if (!vapidConfiguration()) throw new PushError(503, "إعداد الإشعارات غير مكتمل");
    if (!await saveSubscription(actor, input.data, request.headers.get("user-agent"))) throw new PushError(409, "هذا الاشتراك مرتبط بجلسة أخرى. ألغِ اشتراك المتصفح ثم أعد التفعيل.");
    return NextResponse.json({ subscribed: true });
  } catch (error) { return pushError(error); }
}
export async function DELETE(request: Request) {
  try {
    const actor = await pushActor(request, true);
    const input = unsubscribeSchema.safeParse(await pushBody(request));
    if (!input.success) throw new PushError(400, "بيانات الاشتراك غير صحيحة.");
    await removeSubscription(actor, input.data.endpoint);
    return NextResponse.json({ subscribed: false });
  } catch (error) { return pushError(error); }
}
