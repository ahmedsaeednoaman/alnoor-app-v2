"use client";

import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";

import { useDialogScrollLock } from "@/components/settings/users/use-dialog-scroll-lock";

import { AppFooter } from "./app-footer";
import { MobileBottomNavigation } from "./mobile-bottom-navigation";
import { AppNavbar, type AppTheme } from "./app-navbar";
import { AppSidebar } from "./app-sidebar";

type ShellUser = {
  displayName: string;
  username: string;
  allowedModules: string[];
  permissions: string[];
};

type AppShellProps = {
  children: ReactNode;
  user: ShellUser;
};

export function AppShell({ children, user }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState<AppTheme>("dark");

  useDialogScrollLock(drawerOpen, false);

  useLayoutEffect(() => {
    const appliedTheme = document.documentElement.dataset.theme;
    const savedTheme = localStorage.getItem("alnoor-theme");
    const preferredTheme: AppTheme = matchMedia("(prefers-color-scheme: light)")
      .matches
      ? "light"
      : "dark";
    const initialTheme: AppTheme =
      appliedTheme === "light" || appliedTheme === "dark"
        ? appliedTheme
        : savedTheme === "light" || savedTheme === "dark"
          ? savedTheme
          : preferredTheme;

    document.documentElement.dataset.theme = initialTheme;

    const frame = requestAnimationFrame(() => setTheme(initialTheme));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setSidebarCollapsed(
        localStorage.getItem("alnoor-sidebar-collapsed") === "true",
      );
    });

    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [drawerOpen]);

  function toggleTheme() {
    const nextTheme: AppTheme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem("alnoor-theme", nextTheme);
    setTheme(nextTheme);
  }

  function toggleDesktopSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      localStorage.setItem("alnoor-sidebar-collapsed", String(next));
      return next;
    });
  }

  return (
    <div
      className={
        sidebarCollapsed
          ? "app-shell app-shell--sidebar-collapsed"
          : "app-shell"
      }
      dir="rtl"
    >
      <div className="app-shell__background" aria-hidden="true" />

      <AppSidebar
        id="desktop-navigation"
        allowedModules={user.allowedModules}
        permissions={user.permissions}
      />

      <div className="app-shell__workspace">
        <AppNavbar
          displayName={user.displayName}
          username={user.username}
          drawerOpen={drawerOpen}
          sidebarCollapsed={sidebarCollapsed}
          onDrawerToggle={() => setDrawerOpen((current) => !current)}
          onDesktopSidebarToggle={toggleDesktopSidebar}
          onThemeToggle={toggleTheme}
        />

        <div className="app-shell__content">{children}</div>
        <AppFooter />
      </div>

      <div
        className={drawerOpen ? "mobile-nav mobile-nav--open" : "mobile-nav"}
        aria-hidden={!drawerOpen}
      >
        <button
          type="button"
          className="mobile-nav__backdrop"
          aria-label="إغلاق قائمة التنقل"
          onClick={() => setDrawerOpen(false)}
          tabIndex={drawerOpen ? 0 : -1}
        />
        <AppSidebar
          id="mobile-navigation"
          variant="drawer"
          allowedModules={user.allowedModules}
          permissions={user.permissions}
          onNavigate={() => setDrawerOpen(false)}
          onClose={() => setDrawerOpen(false)}
        />
      </div>

      <MobileBottomNavigation
        permissions={user.permissions}
        drawerOpen={drawerOpen}
        onMoreClick={() => setDrawerOpen(true)}
      />
    </div>
  );
}
