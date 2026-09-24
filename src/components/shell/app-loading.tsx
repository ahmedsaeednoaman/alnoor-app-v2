import Image from "next/image";
import type { ReactNode } from "react";

type AppLoadingProps = {
  fullScreen?: boolean;
  busy?: boolean;
  message?: string;
  actions?: ReactNode;
};

export function AppLoading({ fullScreen = false, busy = true, message = "جاري التحميل...", actions }: AppLoadingProps = {}) {
  return (
    <section
      className={`app-route-loading${fullScreen ? " app-route-loading--fullscreen" : ""}${busy ? "" : " app-route-loading--error"}`}
      dir="rtl"
      role={busy ? "status" : "alert"}
      aria-live={busy ? "polite" : "assertive"}
      aria-busy={busy}
      aria-label={busy ? "جاري التحميل" : "تعذر التحقق من الجلسة"}
    >
      <div className="app-route-loading__surface">
        <span className="app-route-loading__logo-wrap" aria-hidden="true">
          <Image
            src="/images/Al-Noor Endoscope Medical Logo.png"
            alt=""
            width={150}
            height={92}
            className="app-route-loading__logo"
            priority
          />
        </span>
        {busy && <span className="app-route-loading__progress" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>}
        <p>{message}</p>
        {actions && <div className="app-route-loading__actions">{actions}</div>}
      </div>
    </section>
  );
}
