CREATE TABLE "doctor_account_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"direction" varchar(16) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"description" varchar(240) NOT NULL,
	"notes" text,
	"idempotency_key" varchar(100) NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "doctor_account_adjustment_direction_valid" CHECK ("doctor_account_adjustments"."direction" in ('debit','credit')),
	CONSTRAINT "doctor_account_adjustment_amount_positive" CHECK ("doctor_account_adjustments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "doctor_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"notes" text,
	"idempotency_key" varchar(100) NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "doctor_payment_amount_positive" CHECK ("doctor_payments"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "doctor_account_adjustments" ADD CONSTRAINT "doctor_account_adjustments_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "doctor_account_adjustments" ADD CONSTRAINT "doctor_account_adjustments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "doctor_payments" ADD CONSTRAINT "doctor_payments_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "doctor_payments" ADD CONSTRAINT "doctor_payments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_account_adjustments_idempotency_unique" ON "doctor_account_adjustments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "doctor_account_adjustments_doctor_idx" ON "doctor_account_adjustments" USING btree ("doctor_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_payments_idempotency_unique" ON "doctor_payments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "doctor_payments_doctor_idx" ON "doctor_payments" USING btree ("doctor_id","paid_at");