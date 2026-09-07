CREATE TYPE "public"."financial_review_definition_kind" AS ENUM('accountant_input', 'calculated', 'operation_field');--> statement-breakpoint
CREATE TYPE "public"."work_form_review_role" AS ENUM('context', 'cost_source', 'hidden');--> statement-breakpoint
ALTER TYPE "public"."financial_item_source_type" ADD VALUE 'stent' BEFORE 'manual';--> statement-breakpoint
ALTER TYPE "public"."work_form_reference_source" ADD VALUE 'stents' BEFORE 'users';--> statement-breakpoint
CREATE TABLE "stents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"normalized_name" varchar(200) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stent_type" varchar(120)
);
--> statement-breakpoint
CREATE TABLE "financial_review_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_type" "operation_type" NOT NULL,
	"stable_key" varchar(100) NOT NULL,
	"label" varchar(180) NOT NULL,
	"kind" "financial_review_definition_kind" NOT NULL,
	"effect" "work_form_financial_effect" DEFAULT 'subtract' NOT NULL,
	"source_field_stable_key" varchar(100),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operation_stents" (
	"operation_id" uuid NOT NULL,
	"stent_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "operation_stents_operation_id_stent_id_pk" PRIMARY KEY("operation_id","stent_id")
);
--> statement-breakpoint
ALTER TABLE "work_form_fields" ADD COLUMN "review_role" "work_form_review_role" DEFAULT 'hidden' NOT NULL;--> statement-breakpoint
ALTER TABLE "stents" ADD CONSTRAINT "stents_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "financial_review_definitions" ADD CONSTRAINT "financial_review_definitions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operation_stents" ADD CONSTRAINT "operation_stents_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "stents_current_name_unique" ON "stents" USING btree ("normalized_name") WHERE "stents"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "stents_name_search_idx" ON "stents" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_review_definitions_type_key_unique" ON "financial_review_definitions" USING btree ("operation_type","stable_key");--> statement-breakpoint
CREATE INDEX "financial_review_definitions_type_idx" ON "financial_review_definitions" USING btree ("operation_type","active");--> statement-breakpoint
CREATE INDEX "operation_stents_operation_idx" ON "operation_stents" USING btree ("operation_id");