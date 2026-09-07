"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { resolveRoute } from "./app-route-labels";

export function AppBreadcrumbs() {
  const items = resolveRoute(usePathname()).breadcrumbs;

  return (
    <nav className="app-breadcrumbs" aria-label="مسار التنقل">
      <ol className="app-breadcrumbs__list">
        {items.map((item, index) => {
          const current = index === items.length - 1;
          return (
            <li className="app-breadcrumbs__item" key={`${index}-${item.label}`}>
              {index > 0 && <span className="app-breadcrumbs__separator" dir="rtl" aria-hidden="true">←</span>}
              {current ? (
                <span className="app-breadcrumbs__current" aria-current="page">{item.label}</span>
              ) : item.href ? (
                <Link className="app-breadcrumbs__link" href={item.href}>{item.label}</Link>
              ) : (
                <span>{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
