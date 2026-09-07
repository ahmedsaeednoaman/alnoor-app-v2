CREATE TYPE "public"."lithotripsy_pricing_profile_line_type" AS ENUM('linked_role','linked_source','fixed_cost','session_cost');--> statement-breakpoint
CREATE TYPE "public"."operation_financial_line_state" AS ENUM('included','excluded');--> statement-breakpoint
CREATE TABLE "lithotripsy_pricing_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(180) NOT NULL,
  "normalized_name" varchar(180) NOT NULL,
  "procedure_set_key" varchar(2000) NOT NULL,
  "is_base" boolean DEFAULT false NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "archived_at" timestamp with time zone,
  "created_by_user_id" uuid NOT NULL,
  "updated_by_user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "lithotripsy_pricing_profiles_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade,
  CONSTRAINT "lithotripsy_pricing_profiles_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX "litho_pricing_profiles_active_set_unique" ON "lithotripsy_pricing_profiles" USING btree ("procedure_set_key") WHERE "active" = true and "archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "litho_pricing_profiles_active_base_unique" ON "lithotripsy_pricing_profiles" USING btree ("is_base") WHERE "active" = true and "archived_at" is null and "is_base" = true;--> statement-breakpoint
CREATE INDEX "litho_pricing_profiles_active_sort_idx" ON "lithotripsy_pricing_profiles" USING btree ("active","sort_order");--> statement-breakpoint
CREATE TABLE "lithotripsy_pricing_profile_procedures" (
  "profile_id" uuid NOT NULL,
  "procedure_id" uuid NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "litho_profile_procedures_pk" PRIMARY KEY("profile_id","procedure_id"),
  CONSTRAINT "litho_profile_procedures_profile_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."lithotripsy_pricing_profiles"("id") ON DELETE restrict ON UPDATE cascade,
  CONSTRAINT "litho_profile_procedures_procedure_fk" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedures"("id") ON DELETE restrict ON UPDATE cascade
);--> statement-breakpoint
CREATE INDEX "litho_pricing_profile_procedures_procedure_idx" ON "lithotripsy_pricing_profile_procedures" USING btree ("procedure_id");--> statement-breakpoint
CREATE TABLE "lithotripsy_pricing_profile_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "profile_id" uuid NOT NULL,
  "pricing_definition_id" uuid,
  "stable_key" varchar(120) NOT NULL,
  "line_type" "public"."lithotripsy_pricing_profile_line_type" NOT NULL,
  "label" varchar(180) NOT NULL,
  "default_amount" numeric(12, 2),
  "effect" "public"."work_form_financial_effect" DEFAULT 'subtract' NOT NULL,
  "source_type" varchar(60),
  "source_reference_id" uuid,
  "session_value" integer,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "archived_at" timestamp with time zone,
  "created_by_user_id" uuid NOT NULL,
  "updated_by_user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "litho_profile_lines_profile_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."lithotripsy_pricing_profiles"("id") ON DELETE restrict ON UPDATE cascade,
  CONSTRAINT "litho_profile_lines_definition_fk" FOREIGN KEY ("pricing_definition_id") REFERENCES "public"."lithotripsy_pricing_definitions"("id") ON DELETE restrict ON UPDATE cascade,
  CONSTRAINT "litho_profile_lines_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade,
  CONSTRAINT "litho_profile_lines_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX "litho_pricing_profile_lines_profile_key_unique" ON "lithotripsy_pricing_profile_lines" USING btree ("profile_id","stable_key");--> statement-breakpoint
CREATE INDEX "litho_pricing_profile_lines_profile_sort_idx" ON "lithotripsy_pricing_profile_lines" USING btree ("profile_id","active","sort_order");--> statement-breakpoint
ALTER TABLE "operation_financial_items" ADD COLUMN "base_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "operation_financial_items" ADD COLUMN "adjustment_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "operation_financial_items" ADD COLUMN "effective_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "operation_financial_items" ADD COLUMN "case_line_state" "public"."operation_financial_line_state" DEFAULT 'included' NOT NULL;--> statement-breakpoint
ALTER TABLE "operation_financial_items" ADD COLUMN "pricing_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "operation_financial_items" ADD COLUMN "pricing_profile_line_id" uuid;--> statement-breakpoint
ALTER TABLE "operation_financial_items" ADD COLUMN "pricing_profile_version" integer;--> statement-breakpoint
ALTER TABLE "operation_financial_items" ADD CONSTRAINT "operation_financial_items_pricing_profile_fk" FOREIGN KEY ("pricing_profile_id") REFERENCES "public"."lithotripsy_pricing_profiles"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operation_financial_items" ADD CONSTRAINT "operation_financial_items_pricing_profile_line_fk" FOREIGN KEY ("pricing_profile_line_id") REFERENCES "public"."lithotripsy_pricing_profile_lines"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operation_financial_items" ADD CONSTRAINT "operation_financial_items_effective_nonnegative" CHECK ("effective_amount" is null or "effective_amount" >= 0);--> statement-breakpoint
ALTER TABLE "operation_financial_items" ADD CONSTRAINT "operation_financial_items_base_nonnegative" CHECK ("base_amount" is null or "base_amount" >= 0);--> statement-breakpoint
ALTER TABLE "operation_financial_items" ADD CONSTRAINT "operation_financial_items_adjustment_consistent" CHECK ("base_amount" is null or "adjustment_amount" is null or "effective_amount" = "base_amount" + "adjustment_amount");--> statement-breakpoint
INSERT INTO "permissions" ("code","module","label") VALUES ('accounting.lithotripsy.pricing.manage','accounting','إدارة أسعار التفتيت') ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id","permission_id") SELECT r.id,p.id FROM "roles" r CROSS JOIN "permissions" p WHERE r.code='owner' AND p.code='accounting.lithotripsy.pricing.manage' ON CONFLICT DO NOTHING;
