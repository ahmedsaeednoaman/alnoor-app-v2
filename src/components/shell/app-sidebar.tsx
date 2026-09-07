"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Swal from "sweetalert2";

import { getAllowedNavigation, type NavigationItem } from "@/lib/navigation";

type AppSidebarProps = {
  allowedModules: string[];
  permissions: string[];
  id?: string;
  variant?: "desktop" | "drawer";
  onNavigate?: () => void;
  onClose?: () => void;
};

function NavigationIcon({ icon }: { icon: NavigationItem["icon"] }) {
  const commonProps = {
    width: 21,
    height: 21,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (icon) {
    case "home":
      return (
        <svg {...commonProps}>
          <path d="m3 11 9-8 9 8" />
          <path d="M5 10v10h14V10" />
          <path d="M9 20v-6h6v6" />
        </svg>
      );

    case "operations":
      return (
        <svg {...commonProps}>
          <rect x="4" y="3" width="16" height="18" rx="3" />
          <path d="M8 8h8M8 12h8M8 16h5" />
        </svg>
      );

    case "review":
      return (
        <svg {...commonProps}>
          <path d="M4 19V5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
          <path d="M14 3v6h6" />
          <path d="m8 15 2 2 5-5" />
        </svg>
      );

    case "doctors":
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="7" r="4" />
          <path d="M5 21c.5-5 3-8 7-8s6.5 3 7 8" />
          <path d="M18 10v5M15.5 12.5h5" />
        </svg>
      );

    case "expenses":
      return (
        <svg {...commonProps}>
          <rect x="3" y="6" width="18" height="14" rx="3" />
          <path d="M3 10h18" />
          <path d="M16 15h2" />
        </svg>
      );

    case "salaries":
      return (
        <svg {...commonProps}>
          <path d="M3 7h18v12H3z" />
          <path d="M7 7V5h10v2" />
          <circle cx="12" cy="13" r="3" />
        </svg>
      );

    case "print":
      return (
        <svg {...commonProps}>
          <path d="M6 9V3h12v6" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="7" />
        </svg>
      );

    case "reports":
      return (
        <svg {...commonProps}>
          <path d="M4 20V10" />
          <path d="M10 20V4" />
          <path d="M16 20v-7" />
          <path d="M22 20H2" />
        </svg>
      );

    case "settings":
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9A1.7 1.7 0 0 0 21 10h.1v4H21a1.7 1.7 0 0 0-1.6 1Z" />
        </svg>
      );
  }
}

function LogoutIcon() {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
      <path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" />
    </svg>
  );
}

function isItemActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === href;
  }

  const isPricingDomain = /^\/accounts\/review\/(lithotripsy|contract|endoscopy)\/pricing(?:\/|$)/u.test(pathname);
  if (href === "/accounts/pricing") return pathname.startsWith(href) || isPricingDomain;
  if (href === "/accounts/review" && isPricingDomain) return false;

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar({
  allowedModules,
  permissions,
  id,
  variant = "desktop",
  onNavigate,
  onClose,
}: AppSidebarProps) {
  const pathname = usePathname();

  async function handleLogout() {
    const confirmation = await Swal.fire({
      icon: "warning",
      iconColor: "#FBBF24",
      imageUrl: "/images/Al-Noor Endoscope Medical Logo.png",
      imageAlt: "النور للمناظير الطبية",
      imageWidth: 135,
      title: "تسجيل الخروج",
      text: "هل تريد تسجيل الخروج من النظام؟",
      confirmButtonText: "نعم، تسجيل الخروج",
      cancelButtonText: "إلغاء",
      showCancelButton: true,
      reverseButtons: true,
      buttonsStyling: false,
      customClass: {
        popup: "alnoor-alert",
        image: "alnoor-alert__logo",
        icon: "alnoor-alert__icon",
        title: "alnoor-alert__title",
        htmlContainer: "alnoor-alert__text",
        confirmButton: "alnoor-alert__button alnoor-alert__button--logout",
        cancelButton: "alnoor-alert__cancel",
      },
      showClass: {
        popup: "alnoor-alert-show",
      },
      hideClass: {
        popup: "alnoor-alert-hide",
      },
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    Swal.fire({
      imageUrl: "/images/Al-Noor Endoscope Medical Logo.png",
      imageAlt: "النور للمناظير الطبية",
      imageWidth: 120,
      title: "جارٍ تسجيل الخروج",
      text: "يرجى الانتظار لحظة...",
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => {
        Swal.showLoading();
      },
      customClass: {
        popup: "alnoor-alert",
        image: "alnoor-alert__logo",
        title: "alnoor-alert__title",
        htmlContainer: "alnoor-alert__text",
      },
    });

    try {
      const response = await fetch("/api/v1/auth/logout", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Logout failed");
      }

      await Swal.close();
      window.location.replace("/login");
    } catch {
      await Swal.fire({
        icon: "error",
        iconColor: "#FB7185",
        imageUrl: "/images/Al-Noor Endoscope Medical Logo.png",
        imageAlt: "النور للمناظير الطبية",
        imageWidth: 135,
        title: "تعذر تسجيل الخروج",
        text: "حدث خطأ أثناء إنهاء الجلسة. حاول مرة أخرى.",
        confirmButtonText: "حسناً",
        buttonsStyling: false,
        customClass: {
          popup: "alnoor-alert",
          image: "alnoor-alert__logo",
          icon: "alnoor-alert__icon",
          title: "alnoor-alert__title",
          htmlContainer: "alnoor-alert__text",
          confirmButton: "alnoor-alert__button",
        },
      });
    }
  }

  const sections = getAllowedNavigation(allowedModules, permissions);

  return (
    <aside
      id={id}
      className={
        variant === "drawer" ? "app-sidebar app-sidebar--drawer" : "app-sidebar"
      }
    >
      <div className="app-sidebar__brand">
        {variant === "drawer" && (
          <button
            type="button"
            className="app-sidebar__close"
            onClick={onClose}
            aria-label="إغلاق قائمة التنقل"
          >
            ×
          </button>
        )}
        <Image
          src="/images/Al-Noor Endoscope Medical Logo.png"
          alt="النور للمناظير الطبية"
          width={190}
          height={115}
          priority
          className="app-sidebar__logo"
        />

        <div className="app-sidebar__brand-copy">
          <strong>النور للمناظير الطبية</strong>
          <span>Medical Operations</span>
        </div>
      </div>

      <div className="app-sidebar__divider" />

      <nav className="app-sidebar__nav" aria-label="التنقل الرئيسي">
        {sections.map((section) => (
          <section
            key={section.label ?? "primary"}
            className="app-sidebar__section"
          >
            {section.label && (
              <p className="app-sidebar__section-title">{section.label}</p>
            )}

            <div className="app-sidebar__items">
              {section.items.map((item) => {
                const active = isItemActive(pathname, item.href);

                return (
                  <Link
                    key={item.code}
                    aria-label={item.label}
                    title={variant === "desktop" ? item.label : undefined}
                    href={item.href}
                    className={[
                      "app-sidebar__item",
                      active ? "app-sidebar__item--active" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-current={active ? "page" : undefined}
                    onClick={onNavigate}
                  >
                    <span className="app-sidebar__item-icon">
                      <NavigationIcon icon={item.icon} />
                    </span>

                    <span className="app-sidebar__item-label">
                      {item.label}
                    </span>

                    {active && (
                      <span
                        className="app-sidebar__active-mark"
                        aria-hidden="true"
                      />
                    )}
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </nav>

      <div className="app-sidebar__bottom">
        <button
          type="button"
          className="app-sidebar__logout"
          onClick={handleLogout}
          aria-label="تسجيل الخروج"
          title={variant === "desktop" ? "تسجيل الخروج" : undefined}
        >
          <span className="app-sidebar__logout-icon">
            <LogoutIcon />
          </span>
          <span>تسجيل الخروج</span>
        </button>

        <div className="app-sidebar__system-state">
          <span className="app-sidebar__system-dot" aria-hidden="true" />
          <span>النظام متصل</span>
        </div>
      </div>
    </aside>
  );
}
