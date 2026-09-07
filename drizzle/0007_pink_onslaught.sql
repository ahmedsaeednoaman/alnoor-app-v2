CREATE TYPE "public"."financial_item_source_type" AS ENUM('dynamic_field', 'procedure', 'equipment', 'consumable', 'manual', 'other');--> statement-breakpoint
ALTER TABLE "operation_financial_items" DROP CONSTRAINT "operation_financial_item_kind_amount";--> statement-breakpoint
ALTER TABLE "operation_financial_items" ADD COLUMN "financial_effect" "work_form_financial_effect" DEFAULT 'add' NOT NULL;--> statement-breakpoint
ALTER TABLE "operation_financial_items" ADD COLUMN "source_type" "financial_item_source_type" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "operation_financial_items" ADD COLUMN "source_field_id" uuid;--> statement-breakpoint
ALTER TABLE "operation_financial_items" ADD COLUMN "source_reference_id" uuid;--> statement-breakpoint
ALTER TABLE "operation_financial_items" ADD CONSTRAINT "operation_financial_items_source_field_id_work_form_fields_id_fk" FOREIGN KEY ("source_field_id") REFERENCES "public"."work_form_fields"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
UPDATE "operation_financial_items" SET "financial_effect" = 'neutral' WHERE "kind" = 'note';--> statement-breakpoint
CREATE UNIQUE INDEX "operation_financial_items_source_unique" ON "operation_financial_items" USING btree ("review_id","source_type","source_field_id","source_reference_id") WHERE "operation_financial_items"."source_type" not in ('manual','other');--> statement-breakpoint
ALTER TABLE "operation_financial_items" ADD CONSTRAINT "operation_financial_item_kind_amount" CHECK (("operation_financial_items"."kind" = 'note' and "operation_financial_items"."amount" is null and "operation_financial_items"."financial_effect" = 'neutral') or ("operation_financial_items"."kind" = 'financial' and "operation_financial_items"."amount" >= 0));
