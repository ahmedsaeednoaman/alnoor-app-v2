export type NavigationItem = {
  code: string;
  label: string;
  href: string;
  enabled?: boolean;
  module?: string;
  anyPermission?: string[];
  icon:
    | "home"
    | "operations"
    | "review"
    | "doctors"
    | "expenses"
    | "salaries"
    | "print"
    | "reports"
    | "settings";
};

export type NavigationSection = {
  label?: string;
  items: NavigationItem[];
};

/**
 * خريطة التنقل الأساسية للنظام.
 *
 * ملاحظة مهمة:
 * هذه القائمة لا تمنح أي صلاحية.
 * الـ Backend / Session هو مصدر الصلاحية الحقيقي.
 *
 * allowedModules يحدد العناصر التي تظهر للمستخدم.
 */
export const navigationSections: NavigationSection[] = [
  {
    items: [
      {
        code: "home",
        label: "الرئيسية",
        href: "/",
        module: "dashboard",
        icon: "home",
      },
    ],
  },

  {
    label: "العمليات",
    items: [
      {
        code: "operations-create",
        label: "إضافة شغل",
        href: "/operations/new",
        module: "operations",
        anyPermission: ["operations.create"],
        icon: "operations",
      },
      {
        code: "operations",
        label: "عرض العمليات",
        href: "/operations",
        module: "operations",
        anyPermission: ["operations.view"],
        icon: "operations",
      },
    ],
  },

  {
    label: "الحسابات",
    items: [
      {
        code: "accounting-review",
        label: "مراجعة الشغل",
        href: "/accounts/review",
        module: "accounting",
        anyPermission: ["accounting.review"],
        icon: "review",
      },
      {
        code: "accounting-pricing",
        label: "بنود وأسعار",
        href: "/accounts/pricing",
        module: "accounting",
        anyPermission: [
          "accounting.lithotripsy.pricing.manage",
          "accounting.contract.pricing.manage",
          "accounting.endoscopy.pricing.manage",
        ],
        icon: "review",
      },

      {
        code: "doctor-accounts",
        label: "حسابات الأطباء",
        href: "/doctor-accounts",
        module: "doctor_accounts",
        icon: "doctors",
        anyPermission: ["doctor_accounts.view"],
      },
    ],
  },

  {
    label: "شؤون الشركة",
    items: [
      {
        code: "expenses",
        label: "المصروفات",
        href: "/company/expenses",
        module: "expenses",
        icon: "expenses",
        anyPermission: ["expenses.create", "expenses.view"],
      },

      {
        code: "salaries",
        label: "المرتبات",
        href: "/company/salaries",
        module: "salaries",
        icon: "salaries",
        enabled: false,
      },
    ],
  },

  {
    label: "الطباعة والتقارير",
    items: [
      {
        code: "printing",
        label: "مركز الطباعة",
        href: "/print",
        module: "printing",
        anyPermission: ["printing.use"],
        icon: "print",
      },

      {
        code: "reports",
        label: "التقارير",
        href: "/reports",
        module: "reports",
        anyPermission: ["reports.view"],
        icon: "reports",
      },
    ],
  },

  {
    label: "النظام",
    items: [
      {
        code: "settings-hub",
        label: "الإعدادات",
        href: "/settings",
        anyPermission: ["users.view", "settings.view"],
        icon: "settings",
      },
    ],
  },
];

/**
 * ترجع القائمة التي يسمح للمستخدم برؤيتها فقط.
 *
 * لو allowedModules تحتوي "*" نعرض الكل.
 */
export function getAllowedNavigation(
  allowedModules: string[],
  permissions: string[] = [],
): NavigationSection[] {
  const hasFullAccess = allowedModules.includes("*");

  return navigationSections
    .map((section) => ({
      ...section,

      items: section.items.filter((item) => {
        if (item.enabled === false) {
          return false;
        }

        if (
          item.anyPermission &&
          !item.anyPermission.some((permission) =>
            permissions.includes(permission),
          )
        ) {
          return false;
        }

        if (hasFullAccess) {
          return true;
        }

        return !item.module || allowedModules.includes(item.module);
      }),
    }))
    .filter((section) => section.items.length > 0);
}
