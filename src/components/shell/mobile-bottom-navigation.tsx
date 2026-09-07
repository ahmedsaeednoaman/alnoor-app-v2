"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type MobileBottomNavigationProps = {
  permissions: string[];
  drawerOpen: boolean;
  onMoreClick: () => void;
};

type IconName = "home" | "operations" | "add" | "expense" | "more";

function NavigationIcon({ name }: { name: IconName }) {
  const props = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "home") {
    return (
      <svg {...props}>
        <path d="m3 11 9-8 9 8" />
        <path d="M5 10v10h14V10" />
        <path d="M9 20v-6h6v6" />
      </svg>
    );
  }

  if (name === "operations") {
    return (
      <svg {...props}>
        <rect x="4" y="3" width="16" height="18" rx="3" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </svg>
    );
  }

  if (name === "add") {
    return (
      <svg {...props}>
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  }

  if (name === "expense") {
    return (
      <svg {...props}>
        <rect x="3" y="6" width="18" height="14" rx="3" />
        <path d="M3 10h18M16 15h2" />
      </svg>
    );
  }

  return (
    <svg {...props}>
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function MobileBottomNavigation({
  permissions,
  drawerOpen,
  onMoreClick,
}: MobileBottomNavigationProps) {
  const pathname = usePathname();

  if (pathname.startsWith("/print/operations/")) {
    return null;
  }

  const canViewOperations = permissions.includes("operations.view");
  const canCreateOperations = permissions.includes("operations.create");
  const canCreateExpenses =
    permissions.includes("expenses.create") || permissions.includes("expenses.view");
  const addWorkActive = pathname === "/operations/new";
  const addExpenseActive = pathname === "/company/expenses/new";
  const operationsActive =
    canViewOperations &&
    pathname.startsWith("/operations") &&
    !pathname.startsWith("/operations/new");

  return (
    <nav className="mobile-bottom-navigation" aria-label="التنقل السريع">
      <Link
        href="/"
        className="mobile-bottom-navigation__item"
        aria-current={pathname === "/" ? "page" : undefined}
      >
        <NavigationIcon name="home" />
        <span>الرئيسية</span>
      </Link>

      {canViewOperations && (
        <Link
          href="/operations"
          className="mobile-bottom-navigation__item"
          aria-current={operationsActive ? "page" : undefined}
        >
          <NavigationIcon name="operations" />
          <span>الشغل</span>
        </Link>
      )}

      {canCreateOperations && (
        <Link
          href="/operations/new"
          className="mobile-bottom-navigation__item mobile-bottom-navigation__item--add"
          aria-current={addWorkActive ? "page" : undefined}
        >
          <span className="mobile-bottom-navigation__add-icon">
            <NavigationIcon name="add" />
          </span>
          <span>إضافة شغل</span>
        </Link>
      )}

      {canCreateExpenses && (
        <Link
          href="/company/expenses/new"
          className="mobile-bottom-navigation__item"
          aria-current={addExpenseActive ? "page" : undefined}
        >
          <NavigationIcon name="expense" />
          <span>مصروف</span>
        </Link>
      )}

      <button
        type="button"
        className="mobile-bottom-navigation__item"
        aria-controls="mobile-navigation"
        aria-expanded={drawerOpen}
        onClick={onMoreClick}
      >
        <NavigationIcon name="more" />
        <span>المزيد</span>
      </button>
    </nav>
  );
}
