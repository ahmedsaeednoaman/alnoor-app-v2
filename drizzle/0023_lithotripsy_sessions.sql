CREATE TABLE IF NOT EXISTS "lithotripsy_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_number" integer NOT NULL,
  "name" varchar(180) NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "archived_at" timestamp with time zone,
  "created_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict ON UPDATE cascade,
  "updated_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict ON UPDATE cascade,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "lithotripsy_sessions_number_positive" CHECK ("session_number" > 0),
  CONSTRAINT "lithotripsy_sessions_order_nonnegative" CHECK ("sort_order" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lithotripsy_sessions_number_unique" ON "lithotripsy_sessions" ("session_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lithotripsy_sessions_active_order_idx" ON "lithotripsy_sessions" ("active", "sort_order");--> statement-breakpoint
INSERT INTO "lithotripsy_sessions" ("session_number","name","sort_order","created_by_user_id","updated_by_user_id")
SELECT n, CASE n WHEN 1 THEN 'الجلسة الأولى' ELSE 'الجلسة الثانية' END, n - 1, u.id, u.id
FROM (VALUES (1),(2)) AS s(n)
CROSS JOIN LATERAL (SELECT u.id FROM users u JOIN roles r ON r.id=u.base_role_id WHERE r.code='owner' AND u.archived_at IS NULL ORDER BY u.created_at LIMIT 1) u
ON CONFLICT ("session_number") DO NOTHING;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN IF NOT EXISTS "lithotripsy_session_id" uuid REFERENCES "lithotripsy_sessions"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lithotripsy_pricing_profiles" ADD COLUMN IF NOT EXISTS "session_id" uuid REFERENCES "lithotripsy_sessions"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
UPDATE "operations" o SET "lithotripsy_session_id"=s.id FROM "lithotripsy_sessions" s WHERE o.type='lithotripsy' AND o.session_count=s.session_number;--> statement-breakpoint
UPDATE "lithotripsy_pricing_profiles" p SET "session_id"=s.id FROM "lithotripsy_sessions" s WHERE p.session_number=s.session_number;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operations_lithotripsy_session_idx" ON "operations" ("lithotripsy_session_id");--> statement-breakpoint
DROP INDEX IF EXISTS "litho_pricing_profiles_active_session_set_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "litho_pricing_profiles_active_session_base_unique";--> statement-breakpoint
ALTER TABLE "lithotripsy_pricing_profiles" DROP CONSTRAINT IF EXISTS "litho_pricing_profiles_session_number_check";--> statement-breakpoint
ALTER TABLE "lithotripsy_pricing_profiles" ADD CONSTRAINT "litho_pricing_profiles_session_number_check" CHECK ("session_number" is null or "session_number" > 0);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "litho_pricing_profiles_active_session_id_set_unique" ON "lithotripsy_pricing_profiles" ("session_id","procedure_set_key") WHERE "active"=true AND "archived_at" IS NULL AND "session_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "litho_pricing_profiles_active_session_id_base_unique" ON "lithotripsy_pricing_profiles" ("session_id") WHERE "active"=true AND "archived_at" IS NULL AND "is_base"=true AND "session_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "litho_pricing_profiles_active_number_compat_set_unique" ON "lithotripsy_pricing_profiles" ("session_number","procedure_set_key") WHERE "active"=true AND "archived_at" IS NULL AND "session_id" IS NULL AND "session_number" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "litho_pricing_profiles_active_number_compat_base_unique" ON "lithotripsy_pricing_profiles" ("session_number") WHERE "active"=true AND "archived_at" IS NULL AND "is_base"=true AND "session_id" IS NULL AND "session_number" IS NOT NULL;
