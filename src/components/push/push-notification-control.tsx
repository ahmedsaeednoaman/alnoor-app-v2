"use client";
import { useEffect, useRef, useState } from "react";
import { applicationServerKey, endpointHash, existingWorker, pushRequest } from "@/lib/push/client";
import styles from "./push-notification-control.module.css";

type Config = { configured: boolean; publicKey: string | null; endpointHashes: string[] };
export function PushNotificationControl() {
  const [config, setConfig] = useState<Config | null>(null);
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [browserSubscribed, setBrowserSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next: Config = await pushRequest("GET");
        const capable = window.isSecureContext && "Notification" in window && "PushManager" in window && "serviceWorker" in navigator;
        const registration = capable ? await navigator.serviceWorker.getRegistration("/") : null;
        const subscription = await registration?.pushManager.getSubscription();
        const saved = subscription ? next.endpointHashes.includes(await endpointHash(subscription.endpoint)) : false;
        if (active) { setConfig(next); setSupported(capable); setPermission(capable ? Notification.permission : "default"); setSubscribed(saved); setBrowserSubscribed(!!subscription); }
      } catch { /* Ineligible/expired sessions get no control; permission is never requested here. */ }
    })();
    return () => { active = false; };
  }, []);
  if (!config) return null;
  async function act(action: "enable" | "disable" | "test") {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage("");
    try {
      if (action === "enable") {
        // Request is directly inside the click path, before awaiting any network/SW work.
        const granted = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
        setPermission(granted);
        if (granted !== "granted") return;
        const latest: Config = await pushRequest("GET");
        if (!latest.configured || !latest.publicKey) throw new Error("إعداد الإشعارات غير مكتمل");
        setConfig(latest);
        const registration = await existingWorker();
        const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(latest.publicKey) });
        setBrowserSubscribed(true);
        const json = subscription.toJSON();
        await pushRequest("POST", { endpoint: subscription.endpoint, keys: json.keys });
        setSubscribed(true); setMessage("الإشعارات مفعلة");
      } else if (action === "disable") {
        const subscription = await (await existingWorker()).pushManager.getSubscription();
        if (subscription) {
          let serverError: unknown;
          try { await pushRequest("DELETE", { endpoint: subscription.endpoint }); setSubscribed(false); } catch (error) { serverError = error; }
          const removed = await subscription.unsubscribe();
          const remaining = !removed && await (await existingWorker()).pushManager.getSubscription();
          setBrowserSubscribed(!!remaining);
          if (serverError) throw new Error("أُلغي اشتراك المتصفح إن أمكن، لكن تعذر تأكيد الحذف من الخادم. أعد المحاولة بعد التفعيل.");
          if (remaining) throw new Error("أُلغي الاشتراك من الخادم، لكن اشتراك المتصفح ما زال موجوداً. أعد محاولة الإلغاء.");
        }
        setSubscribed(false); setMessage("الإشعارات غير مفعلة");
      } else {
        const result = await pushRequest("POST", {}, true);
        if (result.expired) { setSubscribed(false); setMessage("انتهت صلاحية الاشتراك. ألغِه ثم أعد التفعيل."); }
        else setMessage(result.accepted ? "قُبل طلب الاختبار. ظهور الإشعار يعتمد على الجهاز." : "تعذر إرسال إشعار الاختبار. أعد المحاولة لاحقاً.");
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "تعذر إكمال الطلب."); }
    finally { lock.current = false; setBusy(false); }
  }
  const status = !supported ? "الإشعارات غير مدعومة على هذا الجهاز" : permission === "denied" ? "تم حظر الإشعارات من المتصفح" : !config.configured ? "إعداد الإشعارات غير مكتمل" : subscribed ? "الإشعارات مفعلة" : "تفعيل الإشعارات";
  return <details className={styles.control}>
    <summary aria-label="إشعارات الحساب">الإشعارات</summary>
    <div className={styles.panel}>
      <p>{status}</p>
      {supported && <div className={styles.actions}>
        {!subscribed && permission !== "denied" && <button disabled={busy || !config.configured} onClick={() => void act("enable")}>تفعيل الإشعارات</button>}
        {(subscribed || browserSubscribed) && <button disabled={busy} onClick={() => void act("disable")}>إلغاء الإشعارات</button>}
        {subscribed && config.configured && <button disabled={busy} onClick={() => void act("test")}>اختبار الإشعارات</button>}
      </div>}
      <p role="status" aria-live="polite">{busy ? "جارٍ تنفيذ الطلب…" : message}</p>
    </div>
  </details>;
}
