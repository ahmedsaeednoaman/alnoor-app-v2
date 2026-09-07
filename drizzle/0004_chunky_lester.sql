CREATE TYPE "public"."operation_financial_item_kind" AS ENUM('financial', 'note');--> statement-breakpoint
CREATE TYPE "public"."operation_side" AS ENUM('right', 'left', 'bilateral');--> statement-breakpoint
CREATE TYPE "public"."operation_status" AS ENUM('recorded', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."operation_type" AS ENUM('lithotripsy', 'endoscopy', 'contract');--> statement-breakpoint
CREATE TYPE "public"."operation_participant_role" AS ENUM('operator', 'nurse', 'assistant', 'lithotripsy_technician', 'c_arm_technician', 'other');--> statement-breakpoint
CREATE TYPE "public"."financial_review_status" AS ENUM('awaiting_review', 'reviewed', 'partially_paid', 'paid');--> statement-breakpoint
CREATE TABLE "doctor_account_postings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"posted_by_user_id" uuid NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "doctor_account_posting_amount_nonnegative" CHECK ("doctor_account_postings"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "operation_consumables" (
	"operation_id" uuid NOT NULL,
	"consumable_id" uuid NOT NULL,
	"quantity" numeric(10, 2) DEFAULT 1 NOT NULL,
	"notes" text,
	CONSTRAINT "operation_consumables_operation_id_consumable_id_pk" PRIMARY KEY("operation_id","consumable_id"),
	CONSTRAINT "operation_consumables_quantity_positive" CHECK ("operation_consumables"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "operation_equipment" (
	"operation_id" uuid NOT NULL,
	"equipment_id" uuid NOT NULL,
	CONSTRAINT "operation_equipment_operation_id_equipment_id_pk" PRIMARY KEY("operation_id","equipment_id")
);
--> statement-breakpoint
CREATE TABLE "operation_financial_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"catalog_item_id" uuid,
	"kind" "operation_financial_item_kind" NOT NULL,
	"description" varchar(250) NOT NULL,
	"amount" numeric(12, 2),
	"notes" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_financial_item_kind_amount" CHECK (("operation_financial_items"."kind" = 'note' and "operation_financial_items"."amount" is null) or ("operation_financial_items"."kind" = 'financial' and "operation_financial_items"."amount" >= 0))
);
--> statement-breakpoint
CREATE TABLE "operation_financial_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"notes" text,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_financial_payment_positive" CHECK ("operation_financial_payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "operation_financial_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"status" "financial_review_status" DEFAULT 'awaiting_review' NOT NULL,
	"main_amount" numeric(12, 2) DEFAULT 0 NOT NULL,
	"doctor_account_amount" numeric(12, 2) DEFAULT 0 NOT NULL,
	"notes" text,
	"reviewed_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_review_amounts_nonnegative" CHECK ("operation_financial_reviews"."main_amount" >= 0 and "operation_financial_reviews"."doctor_account_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "operation_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"role" "operation_participant_role" NOT NULL,
	"name" varchar(200) NOT NULL,
	"linked_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "operation_procedures" (
	"operation_id" uuid NOT NULL,
	"procedure_id" uuid NOT NULL,
	CONSTRAINT "operation_procedures_operation_id_procedure_id_pk" PRIMARY KEY("operation_id","procedure_id")
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "operation_type" NOT NULL,
	"status" "operation_status" DEFAULT 'recorded' NOT NULL,
	"operation_date" date NOT NULL,
	"daily_sequence" integer NOT NULL,
	"operation_time" varchar(5) NOT NULL,
	"case_name" varchar(250) NOT NULL,
	"doctor_id" uuid,
	"hospital_id" uuid,
	"contract_entity_id" uuid,
	"reference_number" varchar(150),
	"diagnosis" text,
	"notes" text,
	"side" "operation_side",
	"anesthesia_type" varchar(120),
	"anesthesiologist_id" uuid,
	"technician_id" uuid,
	"session_count" integer DEFAULT 1 NOT NULL,
	"operational_amount_received" numeric(12, 2),
	"created_by_user_id" uuid NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"cancelled_by_user_id" uuid,
	"cancellation_reason" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operations_session_count_positive" CHECK ("operations"."session_count" > 0),
	CONSTRAINT "operations_operational_amount_nonnegative" CHECK ("operations"."operational_amount_received" is null or "operations"."operational_amount_received" >= 0)
);
--> statement-breakpoint
ALTER TABLE "doctor_account_postings" ADD CONSTRAINT "doctor_account_postings_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "doctor_account_postings" ADD CONSTRAINT "doctor_account_postings_review_id_operation_financial_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."operation_financial_reviews"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "doctor_account_postings" ADD CONSTRAINT "doctor_account_postings_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "doctor_account_postings" ADD CONSTRAINT "doctor_account_postings_posted_by_user_id_users_id_fk" FOREIGN KEY ("posted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operation_consumables" ADD CONSTRAINT "operation_consumables_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operation_consumables" ADD CONSTRAINT "operation_consumables_consumable_id_consumables_id_fk" FOREIGN KEY ("consumable_id") REFERENCES "public"."consumables"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operation_equipment" ADD CONSTRAINT "operation_equipment_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operation_equipment" ADD CONSTRAINT "operation_equipment_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operation_financial_items" ADD CONSTRAINT "operation_financial_items_review_id_operation_financial_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."operation_financial_reviews"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operation_financial_items" ADD CONSTRAINT "operation_financial_items_catalog_item_id_financial_item_catalog_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."financial_item_catalog"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operation_financial_items" ADD CONSTRAINT "operation_financial_items_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operation_financial_payments" ADD CONSTRAINT "operation_financial_payments_review_id_operation_financial_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."operation_financial_reviews"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operation_financial_payments" ADD CONSTRAINT "operation_financial_payments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operation_financial_reviews" ADD CONSTRAINT "operation_financial_reviews_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operation_financial_reviews" ADD CONSTRAINT "operation_financial_reviews_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operation_participants" ADD CONSTRAINT "operation_participants_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operation_participants" ADD CONSTRAINT "operation_participants_linked_user_id_users_id_fk" FOREIGN KEY ("linked_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operation_procedures" ADD CONSTRAINT "operation_procedures_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operation_procedures" ADD CONSTRAINT "operation_procedures_procedure_id_procedures_id_fk" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedures"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_contract_entity_id_contract_entities_id_fk" FOREIGN KEY ("contract_entity_id") REFERENCES "public"."contract_entities"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_anesthesiologist_id_anesthesiologists_id_fk" FOREIGN KEY ("anesthesiologist_id") REFERENCES "public"."anesthesiologists"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_technician_id_technicians_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."technicians"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_account_postings_operation_unique" ON "doctor_account_postings" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "doctor_account_postings_doctor_idx" ON "doctor_account_postings" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "operation_financial_items_review_idx" ON "operation_financial_items" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "operation_financial_payments_review_idx" ON "operation_financial_payments" USING btree ("review_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operation_financial_reviews_operation_unique" ON "operation_financial_reviews" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "operation_participants_operation_idx" ON "operation_participants" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operations_daily_sequence_unique" ON "operations" USING btree ("operation_date","daily_sequence");--> statement-breakpoint
CREATE INDEX "operations_date_idx" ON "operations" USING btree ("operation_date");--> statement-breakpoint
CREATE INDEX "operations_doctor_idx" ON "operations" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "operations_hospital_idx" ON "operations" USING btree ("hospital_id");--> statement-breakpoint
CREATE INDEX "operations_type_status_idx" ON "operations" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "operations_created_by_idx" ON "operations" USING btree ("created_by_user_id");