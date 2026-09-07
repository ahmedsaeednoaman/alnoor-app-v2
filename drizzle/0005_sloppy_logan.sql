CREATE TYPE "public"."work_form_field_type" AS ENUM('text', 'textarea', 'number', 'money', 'date', 'time', 'boolean', 'select', 'smart_single', 'smart_multi');--> statement-breakpoint
CREATE TYPE "public"."work_form_financial_effect" AS ENUM('add', 'subtract', 'neutral');--> statement-breakpoint
CREATE TYPE "public"."work_form_reference_source" AS ENUM('doctors', 'hospitals', 'procedures', 'equipment', 'consumables', 'anesthesiologists', 'technicians', 'contract_entities', 'users');--> statement-breakpoint
CREATE TYPE "public"."work_form_template_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "operation_field_reference_values" (
	"operation_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"reference_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_field_reference_values_operation_id_field_id_reference_id_pk" PRIMARY KEY("operation_id","field_id","reference_id"),
	CONSTRAINT "operation_field_reference_values_sort_nonnegative" CHECK ("operation_field_reference_values"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "operation_field_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"text_value" text,
	"number_value" numeric(18, 4),
	"money_value" numeric(14, 2),
	"date_value" date,
	"time_value" varchar(5),
	"boolean_value" boolean,
	"reference_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_field_values_exactly_one_value" CHECK (num_nonnulls("operation_field_values"."text_value", "operation_field_values"."number_value", "operation_field_values"."money_value", "operation_field_values"."date_value", "operation_field_values"."time_value", "operation_field_values"."boolean_value", "operation_field_values"."reference_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "work_form_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"stable_key" varchar(100) NOT NULL,
	"label" varchar(180) NOT NULL,
	"description" text,
	"field_type" "work_form_field_type" NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"multiple" boolean DEFAULT false NOT NULL,
	"sort_order" integer NOT NULL,
	"is_system_field" boolean DEFAULT false NOT NULL,
	"smart_dropdown_source" "work_form_reference_source",
	"min_selections" integer,
	"max_selections" integer,
	"show_in_form" boolean DEFAULT true NOT NULL,
	"show_in_details" boolean DEFAULT true NOT NULL,
	"show_in_financial_review" boolean DEFAULT false NOT NULL,
	"show_in_print" boolean DEFAULT false NOT NULL,
	"is_financial" boolean DEFAULT false NOT NULL,
	"financial_effect" "work_form_financial_effect",
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_form_fields_sort_nonnegative" CHECK ("work_form_fields"."sort_order" >= 0),
	CONSTRAINT "work_form_fields_selection_bounds" CHECK (("work_form_fields"."min_selections" is null or "work_form_fields"."min_selections" >= 0) and ("work_form_fields"."max_selections" is null or "work_form_fields"."max_selections" >= coalesce("work_form_fields"."min_selections", 0))),
	CONSTRAINT "work_form_fields_financial_effect_check" CHECK (("work_form_fields"."is_financial" and "work_form_fields"."financial_effect" is not null) or (not "work_form_fields"."is_financial" and "work_form_fields"."financial_effect" is null))
);
--> statement-breakpoint
CREATE TABLE "work_form_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"stable_key" varchar(100) NOT NULL,
	"label" varchar(180) NOT NULL,
	"description" text,
	"sort_order" integer NOT NULL,
	"is_system_section" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_form_sections_sort_nonnegative" CHECK ("work_form_sections"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "work_form_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_type" "operation_type" NOT NULL,
	"name" varchar(150) NOT NULL,
	"version" integer NOT NULL,
	"status" "work_form_template_status" DEFAULT 'draft' NOT NULL,
	"based_on_template_id" uuid,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "work_form_templates_version_positive" CHECK ("work_form_templates"."version" > 0),
	CONSTRAINT "work_form_templates_published_at_check" CHECK (("work_form_templates"."status" = 'published' and "work_form_templates"."published_at" is not null) or "work_form_templates"."status" <> 'published')
);
--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "form_template_id" uuid;--> statement-breakpoint
ALTER TABLE "operation_field_reference_values" ADD CONSTRAINT "operation_field_reference_values_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operation_field_reference_values" ADD CONSTRAINT "operation_field_reference_values_field_id_work_form_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."work_form_fields"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operation_field_values" ADD CONSTRAINT "operation_field_values_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operation_field_values" ADD CONSTRAINT "operation_field_values_field_id_work_form_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."work_form_fields"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_form_fields" ADD CONSTRAINT "work_form_fields_template_id_work_form_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."work_form_templates"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_form_fields" ADD CONSTRAINT "work_form_fields_section_id_work_form_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."work_form_sections"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_form_sections" ADD CONSTRAINT "work_form_sections_template_id_work_form_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."work_form_templates"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_form_templates" ADD CONSTRAINT "work_form_templates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_form_templates" ADD CONSTRAINT "work_form_templates_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "operation_field_reference_values_order_unique" ON "operation_field_reference_values" USING btree ("operation_id","field_id","sort_order");--> statement-breakpoint
CREATE INDEX "operation_field_reference_values_field_idx" ON "operation_field_reference_values" USING btree ("field_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operation_field_values_operation_field_unique" ON "operation_field_values" USING btree ("operation_id","field_id");--> statement-breakpoint
CREATE INDEX "operation_field_values_field_idx" ON "operation_field_values" USING btree ("field_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_form_fields_template_key_unique" ON "work_form_fields" USING btree ("template_id","stable_key");--> statement-breakpoint
CREATE UNIQUE INDEX "work_form_fields_section_order_unique" ON "work_form_fields" USING btree ("section_id","sort_order");--> statement-breakpoint
CREATE INDEX "work_form_fields_template_idx" ON "work_form_fields" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_form_sections_template_key_unique" ON "work_form_sections" USING btree ("template_id","stable_key");--> statement-breakpoint
CREATE UNIQUE INDEX "work_form_sections_template_order_unique" ON "work_form_sections" USING btree ("template_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "work_form_templates_type_version_unique" ON "work_form_templates" USING btree ("operation_type","version");--> statement-breakpoint
CREATE UNIQUE INDEX "work_form_templates_one_published_per_type" ON "work_form_templates" USING btree ("operation_type") WHERE "work_form_templates"."status" = 'published';--> statement-breakpoint
CREATE INDEX "work_form_templates_status_idx" ON "work_form_templates" USING btree ("status");--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_form_template_id_work_form_templates_id_fk" FOREIGN KEY ("form_template_id") REFERENCES "public"."work_form_templates"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "operations_form_template_idx" ON "operations" USING btree ("form_template_id");