"use client";

import { useEffect } from "react";

let activeLocks = 0;
let lockedElements: Array<{ element: HTMLElement; overflow: string }> = [];

export function useDialogScrollLock(
  active = true,
  lockSidebarNavigation = true,
) {
  useEffect(() => {
    if (!active) {
      return;
    }

    if (activeLocks === 0) {
      const candidates = [
        document.documentElement,
        document.body,
        ...document.querySelectorAll<HTMLElement>(
          [
            ".app-shell, .app-shell__workspace, .app-shell__content",
            lockSidebarNavigation ? ".app-sidebar__nav" : "",
          ]
            .filter(Boolean)
            .join(", "),
        ),
      ];

      lockedElements = candidates.map((element) => ({
        element,
        overflow: element.style.overflow,
      }));

      for (const { element } of lockedElements) {
        element.style.overflow = "hidden";
      }
    }

    activeLocks += 1;

    return () => {
      activeLocks = Math.max(0, activeLocks - 1);

      if (activeLocks === 0) {
        for (const { element, overflow } of lockedElements) {
          element.style.overflow = overflow;
        }

        lockedElements = [];
      }
    };
  }, [active, lockSidebarNavigation]);
}
