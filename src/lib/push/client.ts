export function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(decoded, char => char.charCodeAt(0));
}
export async function endpointHash(endpoint: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}
export async function existingWorker() {
  // Registration belongs exclusively to ServiceWorkerRegistration.
  const registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration) throw new Error("افتح النسخة المثبتة أو نسخة الإنتاج لتفعيل الإشعارات.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("لم يجهز التطبيق للإشعارات بعد. أعد المحاولة.")), 8000); })]);
  } finally { clearTimeout(timer); }
}
export async function pushRequest(method: "GET" | "POST" | "DELETE", body?: unknown, test = false) {
  const response = await fetch(`/api/v1/push/${test ? "test" : "subscription"}`, { method, cache: "no-store", ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error?.message || "تعذر إكمال طلب الإشعارات."), { status: response.status });
  return data;
}
