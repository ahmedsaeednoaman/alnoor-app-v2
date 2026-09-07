export type RouteBreadcrumb = { label: string; href?: string };
export type RouteResolution = { title: string; breadcrumbs: RouteBreadcrumb[] };
type RouteDefinition = RouteResolution & { pattern: string };

const home: RouteBreadcrumb = { label: "الرئيسية", href: "/" };
const operations: RouteBreadcrumb = { label: "العمليات" };
const accounts: RouteBreadcrumb = { label: "الحسابات" };
const printAndReports: RouteBreadcrumb = { label: "الطباعة والتقارير" };
const system: RouteBreadcrumb = { label: "النظام" };
const company: RouteBreadcrumb = { label: "شؤون الشركة" };

// Deeper and dynamic routes precede their static parents.
export const routeRegistry: readonly RouteDefinition[] = [
  { pattern: "/company/expenses/new", title: "إضافة مصروف", breadcrumbs: [home, company, { label: "المصاريف", href: "/company/expenses" }, { label: "إضافة مصروف" }] },
  { pattern: "/accounts/review/lithotripsy/pricing", title: "أسعار التفتيت", breadcrumbs: [home, accounts, { label: "بنود وأسعار", href: "/accounts/pricing" }, { label: "التفتيت" }] },
  { pattern: "/accounts/review/endoscopy/pricing", title: "أسعار المناظير", breadcrumbs: [home, accounts, { label: "بنود وأسعار", href: "/accounts/pricing" }, { label: "المناظير" }] },
  { pattern: "/accounts/review/contract/pricing", title: "أسعار التعاقد", breadcrumbs: [home, accounts, { label: "بنود وأسعار", href: "/accounts/pricing" }, { label: "التعاقد" }] },
  { pattern: "/operations/:operationId/edit", title: "تعديل العملية", breadcrumbs: [home, { ...operations, href: "/operations" }, { label: "تعديل العملية" }] },
  { pattern: "/print/operations/:operationId", title: "طباعة العملية", breadcrumbs: [home, printAndReports, { label: "مركز الطباعة", href: "/print" }, { label: "طباعة العملية" }] },
  { pattern: "/doctor-accounts/:doctorId", title: "حساب الطبيب", breadcrumbs: [home, accounts, { label: "حسابات الأطباء", href: "/doctor-accounts" }, { label: "حساب الطبيب" }] },
  { pattern: "/reports/contracts/monthly", title: "التقرير الشهري للتعاقدات", breadcrumbs: [home, printAndReports, { label: "التقارير", href: "/reports" }, { label: "التقرير الشهري للتعاقدات" }] },
  { pattern: "/settings/users", title: "المستخدمون", breadcrumbs: [home, system, { label: "الإعدادات", href: "/settings" }, { label: "المستخدمون" }] },
  { pattern: "/settings/roles", title: "الأدوار والصلاحيات", breadcrumbs: [home, system, { label: "الإعدادات", href: "/settings" }, { label: "الأدوار والصلاحيات" }] },
  { pattern: "/operations/new", title: "إضافة شغل", breadcrumbs: [home, { ...operations, href: "/operations" }, { label: "إضافة شغل" }] },
  { pattern: "/operations/:operationId", title: "تفاصيل العملية", breadcrumbs: [home, { ...operations, href: "/operations" }, { label: "تفاصيل العملية" }] },
  { pattern: "/accounts/review", title: "مراجعة الشغل", breadcrumbs: [home, accounts, { label: "مراجعة الشغل" }] },
  { pattern: "/accounts/pricing", title: "بنود وأسعار", breadcrumbs: [home, accounts, { label: "بنود وأسعار" }] },
  { pattern: "/doctor-accounts", title: "حسابات الأطباء", breadcrumbs: [home, accounts, { label: "حسابات الأطباء" }] },
  { pattern: "/company/expenses", title: "المصاريف", breadcrumbs: [home, company, { label: "المصاريف" }] },
  { pattern: "/operations", title: "عرض الشغل", breadcrumbs: [home, operations, { label: "عرض الشغل" }] },
  { pattern: "/reports", title: "التقارير", breadcrumbs: [home, printAndReports, { label: "التقارير" }] },
  { pattern: "/print", title: "مركز الطباعة", breadcrumbs: [home, printAndReports, { label: "مركز الطباعة" }] },
  { pattern: "/settings", title: "الإعدادات", breadcrumbs: [home, system, { label: "الإعدادات" }] },
  { pattern: "/", title: "الرئيسية", breadcrumbs: [{ label: "الرئيسية" }] },
];

const safeFallbackLabels: Readonly<Record<string, string>> = {
  settings: "الإعدادات", users: "المستخدمون", roles: "الأدوار والصلاحيات",
  operations: "العمليات", new: "إضافة شغل", edit: "تعديل العملية",
  accounts: "الحسابات", pricing: "بنود وأسعار", review: "مراجعة الشغل",
  lithotripsy: "التفتيت", contract: "التعاقد", contracts: "التعاقدات",
  endoscopy: "المناظير", "doctor-accounts": "حسابات الأطباء",
  print: "مركز الطباعة", reports: "التقارير", monthly: "التقرير الشهري",
  company: "شؤون الشركة", expenses: "المصاريف",
};

function normalizePathname(pathname: string) {
  const path = pathname.split(/[?#]/u, 1)[0] || "/";
  return path === "/" ? path : `/${path.split("/").filter(Boolean).join("/")}`;
}

function matches(pattern: string, pathname: string) {
  const patternSegments = pattern.split("/").filter(Boolean);
  const pathSegments = pathname.split("/").filter(Boolean);
  return patternSegments.length === pathSegments.length && patternSegments.every(
    (segment, index) => segment.startsWith(":") || segment === pathSegments[index],
  );
}

function fallbackRoute(pathname: string): RouteResolution {
  const labels = pathname.split("/").filter(Boolean).map((segment) => safeFallbackLabels[segment]).filter((label): label is string => Boolean(label));
  return {
    title: labels.at(-1) ?? "الصفحة الحالية",
    breadcrumbs: [home, ...labels.map((label) => ({ label }))],
  };
}

export function resolveRoute(pathname: string): RouteResolution {
  const normalized = normalizePathname(pathname);
  return routeRegistry.find((route) => matches(route.pattern, normalized)) ?? fallbackRoute(normalized);
}

export function getRouteTitle(pathname: string) {
  return resolveRoute(pathname).title;
}
