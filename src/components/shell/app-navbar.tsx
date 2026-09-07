"use client";

import { usePathname } from "next/navigation";
import { PushNotificationControl } from "@/components/push/push-notification-control";

import { AppBreadcrumbs } from "./app-breadcrumbs";
import { getRouteTitle } from "./app-route-labels";

export type AppTheme = "dark" | "light";

type AppNavbarProps = {
  displayName: string;
  username: string;
  drawerOpen: boolean;
  sidebarCollapsed: boolean;
  onDrawerToggle: () => void;
  onDesktopSidebarToggle: () => void;
  onThemeToggle: () => void;
};

function MenuIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function ThemeIcon() {
  return (
    <>
      <svg
        className="app-navbar__theme-sun"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" />
      </svg>
      <svg
        className="app-navbar__theme-moon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
      </svg>
    </>
  );
}

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 10 3 3 3-3" />
    </svg>
  );
}

export function AppNavbar({
  displayName,
  username,
  drawerOpen,
  sidebarCollapsed,
  onDrawerToggle,
  onDesktopSidebarToggle,
  onThemeToggle,
}: AppNavbarProps) {
  const pathname = usePathname();
  const pageTitle = getRouteTitle(pathname);
  const initial =
    displayName.trim().charAt(0) || username.trim().charAt(0) || "ن";

  return (
    <header className="app-navbar">
      <div className="app-navbar__navigation-controls">
        <button
          type="button"
          className="app-navbar__icon-button app-navbar__sidebar-toggle"
          aria-label={
            sidebarCollapsed ? "توسيع الشريط الجانبي" : "طي الشريط الجانبي"
          }
          aria-expanded={!sidebarCollapsed}
          aria-controls="desktop-navigation"
          title={
            sidebarCollapsed ? "توسيع الشريط الجانبي" : "طي الشريط الجانبي"
          }
          onClick={onDesktopSidebarToggle}
        >
          <MenuIcon />
        </button>
        <button
          type="button"
          className="app-navbar__icon-button app-navbar__menu"
          aria-label={drawerOpen ? "إغلاق قائمة التنقل" : "فتح قائمة التنقل"}
          aria-expanded={drawerOpen}
          aria-controls="mobile-navigation"
          title="قائمة التنقل"
          onClick={onDrawerToggle}
        >
          <MenuIcon />
        </button>
      </div>

      <div className="app-navbar__page">
        <span className="app-navbar__eyebrow">النور للمناظير الطبية</span>
        <h1>{pageTitle}</h1>
        <AppBreadcrumbs />
      </div>

      <div className="app-navbar__actions">
        <PushNotificationControl />
        <button
          type="button"
          className="app-navbar__icon-button app-navbar__theme"
          aria-label="تبديل المظهر بين الفاتح والداكن"
          title="تبديل المظهر"
          onClick={onThemeToggle}
        >
          <ThemeIcon />
        </button>
        <div className="app-navbar__separator" />
        <button
          type="button"
          className="app-navbar__user"
          aria-label="قائمة المستخدم"
        >
          <span className="app-navbar__avatar">{initial}</span>
          <span className="app-navbar__user-copy">
            <strong>{displayName}</strong>
            <span dir="ltr">@{username}</span>
          </span>
          <span className="app-navbar__chevron">
            <ChevronIcon />
          </span>
        </button>
      </div>
    </header>
  );
}
