import { postgresClient } from "@/db/client";
import type { PushActor, SubscriptionInput } from "./validation";

export type StoredSubscription = { id: string; endpoint: string; p256dh: string; auth: string; updatedAt: string };
export async function sessionSubscriptions(actor: PushActor) {
  return postgresClient.unsafe<StoredSubscription[]>(`SELECT p.id,p.endpoint,p.p256dh,p.auth,p.updated_at::text "updatedAt"
    FROM push_subscriptions p JOIN sessions s ON s.id=p.session_id AND s.user_id=p.user_id
    JOIN users u ON u.id=p.user_id
    WHERE p.user_id=$1::uuid AND p.session_id=$2::uuid AND s.revoked_at IS NULL AND s.expires_at>now()
    AND u.status='active' AND u.archived_at IS NULL LIMIT 10`, [actor.user.id, actor.session.id]);
}
export async function saveSubscription(actor: PushActor, input: SubscriptionInput, userAgent: string | null) {
  // Same-session rotation is allowed. Other sessions must prove the old browser keys;
  // cross-account rebinding additionally requires the old session to be inactive.
  const rows = await postgresClient.unsafe(`INSERT INTO push_subscriptions(user_id,session_id,endpoint,p256dh,auth,user_agent)
    VALUES($1::uuid,$2::uuid,$3,$4,$5,$6)
    ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,session_id=excluded.session_id,
      p256dh=excluded.p256dh,auth=excluded.auth,user_agent=excluded.user_agent,updated_at=now()
    WHERE (push_subscriptions.user_id=excluded.user_id AND push_subscriptions.session_id=excluded.session_id)
      OR (push_subscriptions.p256dh=excluded.p256dh AND push_subscriptions.auth=excluded.auth AND
        (push_subscriptions.user_id=excluded.user_id OR NOT EXISTS (
          SELECT 1 FROM sessions s WHERE s.id=push_subscriptions.session_id AND s.revoked_at IS NULL AND s.expires_at>now())))
    RETURNING id`, [actor.user.id, actor.session.id, input.endpoint, input.keys.p256dh, input.keys.auth, userAgent?.slice(0, 512) ?? null]);
  return rows.length > 0;
}
export async function removeSubscription(actor: PushActor, endpoint: string) {
  await postgresClient.unsafe("DELETE FROM push_subscriptions WHERE user_id=$1::uuid AND session_id=$2::uuid AND endpoint=$3", [actor.user.id, actor.session.id, endpoint]);
}
export async function removeExpiredSubscription(actor: PushActor, row: StoredSubscription) {
  await postgresClient.unsafe(`DELETE FROM push_subscriptions WHERE id=$1::uuid AND user_id=$2::uuid AND session_id=$3::uuid
    AND endpoint=$4 AND p256dh=$5 AND auth=$6 AND updated_at=$7::timestamptz`, [row.id, actor.user.id, actor.session.id, row.endpoint, row.p256dh, row.auth, row.updatedAt]);
}
