ALTER TYPE "public"."work_form_reference_source" ADD VALUE 'anesthesia_types' BEFORE 'users';--> statement-breakpoint
CREATE TABLE "anesthesia_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"normalized_name" varchar(200) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operation_financial_reviews" ADD COLUMN "doctor_balance_received" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "anesthesia_types" ADD CONSTRAINT "anesthesia_types_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "anesthesia_types_current_name_unique" ON "anesthesia_types" USING btree ("normalized_name") WHERE "anesthesia_types"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "anesthesia_types_name_search_idx" ON "anesthesia_types" USING btree ("normalized_name");