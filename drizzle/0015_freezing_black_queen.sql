ALTER TABLE "financial_review_definitions" ADD COLUMN "visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_review_definitions" ADD COLUMN "width" varchar(20) DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_review_definitions" ADD COLUMN "protected" boolean DEFAULT false NOT NULL;