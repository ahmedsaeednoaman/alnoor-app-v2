import { z } from "zod";

export function isPushEndpoint(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname;
    const allowed = host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" || host === "web.push.apple.com" || host.endsWith(".notify.windows.com");
    return allowed && url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash;
  } catch { return false; }
}
const endpoint = z.string().max(2048).refine(value => Buffer.byteLength(value, "utf8") <= 2048).refine(isPushEndpoint);
const key = (bytes: number) => z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).max(128).refine(value => {
  const raw = Buffer.from(value, "base64url");
  return raw.length === bytes && raw.toString("base64url") === value.replace(/=+$/, "") && (bytes !== 65 || raw[0] === 4);
});
export const subscriptionSchema = z.object({ endpoint, keys: z.object({ p256dh: key(65), auth: key(16) }).strict() }).strict();
export const unsubscribeSchema = z.object({ endpoint }).strict();
export type SubscriptionInput = z.infer<typeof subscriptionSchema>;
export type PushActor = { user: { id: string; role: { code: string }; permissions: string[] }; session: { id: string } };
export function isPushEligible(user: PushActor["user"]) {
  return ["owner", "accountant"].includes(user.role.code) && user.permissions.includes("operations.view");
}
export function providerFailure(error: unknown): "expired" | "temporary" {
  const status = error && typeof error === "object" && "statusCode" in error ? error.statusCode : null;
  return status === 404 || status === 410 ? "expired" : "temporary";
}
export const testPayload = { type: "push-test", url: "/operations" } as const;
