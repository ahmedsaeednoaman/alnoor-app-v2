CREATE TABLE "operation_tax_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"tax_registry" varchar(10) NOT NULL,
	"invoice_number" varchar(100) NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_tax_invoices_registry_valid" CHECK ("operation_tax_invoices"."tax_registry" in ('alnoor', 'alkawthar')),
	CONSTRAINT "operation_tax_invoices_number_digits" CHECK ("operation_tax_invoices"."invoice_number" ~ '^[0-9]+$')
);
--> statement-breakpoint
ALTER TABLE "operation_tax_invoices" ADD CONSTRAINT "operation_tax_invoices_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_tax_invoices" ADD CONSTRAINT "operation_tax_invoices_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operation_tax_invoices_operation_unique" ON "operation_tax_invoices" USING btree ("operation_id");