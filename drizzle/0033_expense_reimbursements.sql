CREATE TYPE "public"."reimbursement_status" AS ENUM('unpaid', 'paid');--> statement-breakpoint
ALTER TABLE "company_expenses" ADD COLUMN "reimbursement_status" "reimbursement_status" DEFAULT 'unpaid' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_expenses" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "company_expenses" ADD COLUMN "paid_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "company_expenses" ADD CONSTRAINT "company_expenses_paid_by_user_id_users_id_fk" FOREIGN KEY ("paid_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "company_expenses_status_date_idx" ON "company_expenses" USING btree ("reimbursement_status","expense_date" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "company_expenses" ADD CONSTRAINT "company_expenses_paid_audit_valid" CHECK (("company_expenses"."reimbursement_status" = 'unpaid' and "company_expenses"."paid_at" is null and "company_expenses"."paid_by_user_id" is null) or ("company_expenses"."reimbursement_status" = 'paid' and "company_expenses"."paid_at" is not null and "company_expenses"."paid_by_user_id" is not null));