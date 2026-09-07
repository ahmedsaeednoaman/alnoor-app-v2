import Image from "next/image";

export function AppLoading() {
  return (
    <section
      className="app-route-loading"
      aria-live="polite"
      aria-busy="true"
      aria-label="جاري التحميل"
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
        <span className="app-route-loading__progress" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <p>جاري التحميل...</p>
      </div>
    </section>
  );
}
