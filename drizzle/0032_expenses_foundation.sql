CREATE TABLE "company_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"employee_name_snapshot" varchar(150) NOT NULL,
	"expense_date" date NOT NULL,
	"expense_time" varchar(5) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"category_id" uuid NOT NULL,
	"category_name_snapshot" varchar(120) NOT NULL,
	"description" varchar(500) NOT NULL,
	"notes" text,
	"idempotency_key" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_expenses_amount_positive" CHECK ("company_expenses"."amount" > 0),
	CONSTRAINT "company_expenses_time_valid" CHECK ("company_expenses"."expense_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"normalized_name" varchar(120) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_expenses" ADD CONSTRAINT "company_expenses_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "company_expenses" ADD CONSTRAINT "company_expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "company_expenses_idempotency_key_unique" ON "company_expenses" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "company_expenses_date_creator_idx" ON "company_expenses" USING btree ("expense_date" DESC NULLS LAST,"created_by_user_id");--> statement-breakpoint
CREATE INDEX "company_expenses_creator_idx" ON "company_expenses" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "company_expenses_category_idx" ON "company_expenses" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_normalized_name_unique" ON "expense_categories" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "expense_categories_active_name_idx" ON "expense_categories" USING btree ("is_active","normalized_name");--> statement-breakpoint
INSERT INTO "expense_categories" ("name", "normalized_name", "is_active")
VALUES
	('سيارات', 'سيارات', true),
	('بنزين', 'بنزين', true),
	('انتقالات', 'انتقالات', true),
	('انتظار', 'انتظار', true),
	('مستلزمات', 'مستلزمات', true),
	('أخرى', 'أخرى', true)
ON CONFLICT ("normalized_name") DO NOTHING;
