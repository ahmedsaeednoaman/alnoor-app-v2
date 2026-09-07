export type CanonicalPermission = { code: string; module: string; label: string };
export type CanonicalRole = { code: string; name: string; description: string };

export const permissionCatalog: readonly CanonicalPermission[] = [
  ["dashboard.view", "dashboard", "عرض الصفحة الرئيسية"],
  ["operations.view", "operations", "عرض العمليات"], ["operations.create", "operations", "إضافة شغل"],
  ["operations.edit", "operations", "تعديل العمليات"], ["operations.cancel", "operations", "إلغاء العمليات"],
  ["expenses.create", "expenses", "إضافة مصروف"], ["expenses.view", "expenses", "عرض المصروفات"], ["expenses.review", "expenses", "مراجعة المصروفات"],
  ["accounting.review", "accounting", "مراجعة الشغل"], ["accounting.finance.view", "accounting", "عرض القيم المالية"], ["accounting.finance.edit", "accounting", "تعديل القيم المالية"], ["accounting.review.layout.manage", "accounting", "إدارة إعداد جدول المراجعة"],
  ["accounting.lithotripsy.pricing.manage", "accounting", "إدارة أسعار التفتيت"], ["accounting.contract.pricing.manage", "accounting", "إدارة أسعار التعاقد"], ["accounting.endoscopy.pricing.manage", "accounting", "إدارة أسعار المناظير"],
  ["doctor_accounts.view", "doctor_accounts", "عرض حسابات الأطباء"], ["doctor_accounts.post", "doctor_accounts", "الترحيل لحساب الطبيب"], ["doctor_accounts.pay", "doctor_accounts", "تسجيل دفعات الأطباء"],
  ["printing.use", "printing", "استخدام مركز الطباعة"], ["reports.view", "reports", "عرض التقارير"], ["reports.create", "reports", "إنشاء التقارير"],
  ["salaries.view", "salaries", "عرض المرتبات"], ["salaries.manage", "salaries", "إدارة المرتبات"], ["users.view", "users", "عرض المستخدمين"], ["users.manage", "users", "إدارة المستخدمين"],
  ["settings.view", "settings", "عرض الإعدادات"], ["settings.manage", "settings", "إدارة الإعدادات"], ["settings.work_forms.manage", "settings", "إدارة نماذج الشغل"],
  ["catalogs.view", "catalogs", "عرض القوائم الأساسية"], ["catalogs.manage", "catalogs", "إدارة القوائم الأساسية"],
].map(([code, module, label]) => ({ code, module, label }));

export const employeePermissions = ["dashboard.view", "operations.view", "operations.create", "expenses.create", "catalogs.view"] as const;
export const accountantPermissions = [
  "dashboard.view", "operations.view", "operations.create", "operations.edit", "operations.cancel", "expenses.view", "expenses.create", "expenses.review",
  "accounting.review", "accounting.finance.view", "accounting.finance.edit", "accounting.contract.pricing.manage", "accounting.endoscopy.pricing.manage",
  "doctor_accounts.view", "doctor_accounts.post", "doctor_accounts.pay", "printing.use", "reports.view", "catalogs.view",
] as const;
export const canonicalRoles: readonly CanonicalRole[] = [
  { code: "owner", name: "صاحب الشركة", description: "صلاحيات كاملة للنظام" },
  { code: "accountant", name: "المحاسب", description: "صلاحيات المراجعة والحسابات" },
  { code: "employee", name: "الموظف", description: "صلاحيات التشغيل الأساسية" },
];
