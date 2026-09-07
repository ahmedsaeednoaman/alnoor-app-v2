import "server-only";
import { createECDH } from "node:crypto";
import webpush from "web-push";
import { providerFailure, subscriptionSchema, testPayload, type PushActor } from "./validation";
import { removeExpiredSubscription, type StoredSubscription } from "./store";

export function vapidConfiguration() {
  const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  try {
    if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(subject)) return null;
    const ec = createECDH("prime256v1");
    if (Buffer.from(privateKey, "base64url").length !== 32) return null;
    ec.setPrivateKey(Buffer.from(privateKey, "base64url"));
    if (ec.getPublicKey().toString("base64url") !== publicKey) return null;
    return { subject, publicKey, privateKey };
  } catch { return null; }
}
export async function sendSelfTest(actor: PushActor, row: StoredSubscription) {
  const vapidDetails = vapidConfiguration();
  if (!vapidDetails) return "unconfigured" as const;
  const input = subscriptionSchema.safeParse({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } });
  if (!input.success) return "failed" as const;
  try {
    await webpush.sendNotification(input.data, JSON.stringify(testPayload), { vapidDetails, TTL: 60, timeout: 5000, urgency: "normal" });
    return "accepted" as const;
  } catch (error) {
    if (providerFailure(error) === "expired") { await removeExpiredSubscription(actor, row); return "expired" as const; }
    return "failed" as const;
  }
}
