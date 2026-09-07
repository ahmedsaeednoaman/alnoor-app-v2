CREATE TYPE "public"."permission_override_effect" AS ENUM('grant', 'deny');--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(100) NOT NULL,
	"module" varchar(50) NOT NULL,
	"label" varchar(150) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "user_permission_overrides" (
	"user_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"effect" "permission_override_effect" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_permission_overrides_pk" PRIMARY KEY("user_id","permission_id")
);
--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_code_unique" ON "permissions" USING btree ("code");--> statement-breakpoint
-- Backfill the canonical permission catalog before removing the legacy JSONB
-- columns. This keeps the migration safe for databases that already contain
-- roles and users from 0000.
INSERT INTO "permissions" ("code", "module", "label") VALUES
	('dashboard.view', 'dashboard', 'عرض الصفحة الرئيسية'),
	('operations.view', 'operations', 'عرض العمليات'),
	('operations.create', 'operations', 'إضافة شغل'),
	('operations.edit', 'operations', 'تعديل العمليات'),
	('operations.cancel', 'operations', 'إلغاء العمليات'),
	('expenses.create', 'expenses', 'إضافة مصروف'),
	('expenses.view', 'expenses', 'عرض المصروفات'),
	('expenses.review', 'expenses', 'مراجعة المصروفات'),
	('accounting.review', 'accounting', 'مراجعة الشغل'),
	('accounting.finance.view', 'accounting', 'عرض القيم المالية'),
	('accounting.finance.edit', 'accounting', 'تعديل القيم المالية'),
	('doctor_accounts.view', 'doctor_accounts', 'عرض حسابات الأطباء'),
	('doctor_accounts.post', 'doctor_accounts', 'الترحيل لحساب الطبيب'),
	('doctor_accounts.pay', 'doctor_accounts', 'تسجيل دفعات الأطباء'),
	('printing.use', 'printing', 'استخدام مركز الطباعة'),
	('reports.view', 'reports', 'عرض التقارير'),
	('reports.create', 'reports', 'إنشاء التقارير'),
	('salaries.view', 'salaries', 'عرض المرتبات'),
	('salaries.manage', 'salaries', 'إدارة المرتبات'),
	('users.view', 'users', 'عرض المستخدمين'),
	('users.manage', 'users', 'إدارة المستخدمين'),
	('settings.view', 'settings', 'عرض الإعدادات'),
	('settings.manage', 'settings', 'إدارة الإعدادات')
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
-- A legacy wildcard means full catalog access. Otherwise, preserve every
-- legacy permission code that exists in the normalized catalog.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."permissions" @> '["*"]'::jsonb
   OR r."permissions" @> to_jsonb(ARRAY[p."code"]::text[])
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "roles" DROP COLUMN "permissions";--> statement-breakpoint
ALTER TABLE "roles" DROP COLUMN "allowed_modules";
