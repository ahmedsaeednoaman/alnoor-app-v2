ALTER TABLE "lithotripsy_pricing_profiles"
ADD COLUMN "session_number" integer;--> statement-breakpoint
ALTER TABLE "lithotripsy_pricing_profiles"
ADD CONSTRAINT "litho_pricing_profiles_session_number_check"
CHECK ("session_number" is null or "session_number" in (1, 2));--> statement-breakpoint
DROP INDEX IF EXISTS "litho_pricing_profiles_active_set_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "litho_pricing_profiles_active_base_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "litho_pricing_profiles_active_session_set_unique"
ON "lithotripsy_pricing_profiles" ("session_number", "procedure_set_key")
WHERE "active" = true and "archived_at" is null and "session_number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "litho_pricing_profiles_active_legacy_set_unique"
ON "lithotripsy_pricing_profiles" ("procedure_set_key")
WHERE "active" = true and "archived_at" is null and "session_number" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "litho_pricing_profiles_active_session_base_unique"
ON "lithotripsy_pricing_profiles" ("session_number")
WHERE "active" = true and "archived_at" is null and "is_base" = true and "session_number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "litho_pricing_profiles_active_legacy_base_unique"
ON "lithotripsy_pricing_profiles" ("is_base")
WHERE "active" = true and "archived_at" is null and "is_base" = true and "session_number" is null;
