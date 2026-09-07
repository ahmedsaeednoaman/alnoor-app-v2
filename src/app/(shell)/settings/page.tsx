import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "الإعدادات",
};

function SettingsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14v-4a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3h4a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9A1.7 1.7 0 0 0 21 10v4a1.7 1.7 0 0 0-1.6 1Z" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function RolesIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3 4 7v5c0 4.8 3.2 7.8 8 9 4.8-1.2 8-4.2 8-9V7Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function ArrowIcon() {
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
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export default async function SettingsPage() {
  const auth = await getCurrentSession();

  if (!auth) {
    redirect("/login");
  }

  const canViewUsers = auth.user.permissions.includes("users.view");
  const canViewRoles = auth.user.permissions.includes("settings.view");

  if (!canViewUsers && !canViewRoles) {
    redirect("/");
  }

  const destinations = [
    canViewUsers
      ? {
          href: "/settings/users",
          title: "إدارة المستخدمين",
          description:
            "إنشاء وإدارة الحسابات والحالات والأرشفة وكلمات المرور والصلاحيات المخصصة.",
          icon: <UsersIcon />,
        }
      : null,
    canViewRoles
      ? {
          href: "/settings/roles",
          title: "الأدوار والصلاحيات",
          description:
            "مراجعة وإدارة الصلاحيات الافتراضية لدوري الموظف والمحاسب.",
          icon: <RolesIcon />,
        }
      : null,
  ].filter((destination) => destination !== null);

  return (
    <div className="users-page settings-hub">
      <section className="users-page__hero">
        <div className="users-page__hero-copy">
          <span className="users-page__hero-icon">
            <SettingsIcon />
          </span>
          <div>
            <span className="users-page__eyebrow">إدارة النظام</span>
            <h2>الإعدادات</h2>
            <p>
              اختر القسم الذي تريد إدارته. تظهر هنا فقط الأقسام التي تسمح بها
              صلاحيات حسابك الحالية.
            </p>
          </div>
        </div>
      </section>

      <section className="settings-hub__cards" aria-label="أقسام الإعدادات">
        {destinations.map((destination) => (
          <Link
            href={destination.href}
            className="settings-hub__card"
            key={destination.href}
          >
            <span className="settings-hub__card-icon">{destination.icon}</span>
            <span className="settings-hub__card-copy">
              <strong>{destination.title}</strong>
              <span>{destination.description}</span>
            </span>
            <span className="settings-hub__card-arrow">
              <ArrowIcon />
            </span>
          </Link>
        ))}
      </section>
    </div>
  );
}
