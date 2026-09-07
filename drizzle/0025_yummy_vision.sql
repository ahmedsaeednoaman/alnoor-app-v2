CREATE TABLE "service_pricing_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"source_type" "financial_item_source_type" NOT NULL,
	"source_reference_id" uuid,
	"label" varchar(220) NOT NULL,
	"default_amount" numeric(12, 2),
	"effect" "work_form_financial_effect" DEFAULT 'subtract' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by_user_id" uuid NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "service_pricing_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_type" "operation_type" NOT NULL,
	"hospital_id" uuid,
	"name" varchar(180) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by_user_id" uuid NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "service_pricing_profiles_scope_check" CHECK (("service_pricing_profiles"."operation_type" = 'contract' and "service_pricing_profiles"."hospital_id" is not null) or ("service_pricing_profiles"."operation_type" = 'endoscopy' and "service_pricing_profiles"."hospital_id" is null)),
	CONSTRAINT "service_pricing_profiles_domain_check" CHECK ("service_pricing_profiles"."operation_type" in ('contract','endoscopy'))
);
--> statement-breakpoint
ALTER TABLE "operation_financial_items" ADD COLUMN "service_pricing_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "operation_financial_items" ADD COLUMN "service_pricing_item_id" uuid;--> statement-breakpoint
ALTER TABLE "operation_financial_items" ADD COLUMN "service_pricing_version" integer;--> statement-breakpoint
ALTER TABLE "service_pricing_items" ADD CONSTRAINT "service_pricing_items_profile_id_service_pricing_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."service_pricing_profiles"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "service_pricing_items" ADD CONSTRAINT "service_pricing_items_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "service_pricing_items" ADD CONSTRAINT "service_pricing_items_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "service_pricing_profiles" ADD CONSTRAINT "service_pricing_profiles_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "service_pricing_profiles" ADD CONSTRAINT "service_pricing_profiles_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "service_pricing_profiles" ADD CONSTRAINT "service_pricing_profiles_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "service_pricing_items_profile_idx" ON "service_pricing_items" USING btree ("profile_id","active","sort_order");--> statement-breakpoint
CREATE INDEX "service_pricing_profiles_domain_idx" ON "service_pricing_profiles" USING btree ("operation_type","active");--> statement-breakpoint
CREATE UNIQUE INDEX "service_pricing_profiles_contract_hospital_unique" ON "service_pricing_profiles" ("hospital_id") WHERE "operation_type"='contract' AND "active"=true;--> statement-breakpoint
CREATE UNIQUE INDEX "service_pricing_profiles_endoscopy_global_unique" ON "service_pricing_profiles" ("operation_type") WHERE "operation_type"='endoscopy' AND "active"=true;--> statement-breakpoint
ALTER TABLE "operation_financial_items" ADD CONSTRAINT "operation_financial_items_service_pricing_profile_id_service_pricing_profiles_id_fk" FOREIGN KEY ("service_pricing_profile_id") REFERENCES "public"."service_pricing_profiles"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operation_financial_items" ADD CONSTRAINT "operation_financial_items_service_pricing_item_id_service_pricing_items_id_fk" FOREIGN KEY ("service_pricing_item_id") REFERENCES "public"."service_pricing_items"("id") ON DELETE restrict ON UPDATE cascade;
