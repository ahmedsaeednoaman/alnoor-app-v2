CREATE TYPE "public"."financial_review_accounting_mode" AS ENUM('main_amount', 'direct_items');--> statement-breakpoint
ALTER TABLE "operation_financial_reviews" ADD COLUMN "accounting_mode" "financial_review_accounting_mode" DEFAULT 'main_amount' NOT NULL;--> statement-breakpoint
ALTER TABLE "operation_financial_reviews" ADD COLUMN "doctor_received_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "operation_financial_reviews" ADD CONSTRAINT "financial_review_received_nonnegative" CHECK ("operation_financial_reviews"."doctor_received_amount" is null or "operation_financial_reviews"."doctor_received_amount" >= 0);
