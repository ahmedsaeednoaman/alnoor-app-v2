CREATE TYPE "public"."contract_entity_type" AS ENUM('health_insurance', 'contracted_hospital', 'other');--> statement-breakpoint
CREATE TYPE "public"."financial_item_kind" AS ENUM('financial', 'note');--> statement-breakpoint
CREATE TABLE "anesthesiologists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"normalized_name" varchar(200) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"phone" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "consumables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"normalized_name" varchar(200) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"default_note" text
);
--> statement-breakpoint
CREATE TABLE "contract_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"normalized_name" varchar(200) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entity_type" "contract_entity_type" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"normalized_name" varchar(200) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"specialty" varchar(150),
	"phone" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"normalized_name" varchar(200) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"equipment_type" varchar(120) NOT NULL,
	"fixed_hospital_id" uuid
);
--> statement-breakpoint
CREATE TABLE "financial_item_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"normalized_name" varchar(200) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"default_kind" "financial_item_kind" NOT NULL,
	"default_amount" numeric(12, 2),
	CONSTRAINT "financial_item_note_amount_null_check" CHECK ("financial_item_catalog"."default_kind" <> 'note' or "financial_item_catalog"."default_amount" is null),
	CONSTRAINT "financial_item_amount_nonnegative_check" CHECK ("financial_item_catalog"."default_amount" is null or "financial_item_catalog"."default_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "hospitals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"normalized_name" varchar(200) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"address" text,
	"contract_entity_id" uuid
);
--> statement-breakpoint
CREATE TABLE "procedures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"normalized_name" varchar(200) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"category" varchar(120) NOT NULL,
	"supports_side" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "technicians" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"normalized_name" varchar(200) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"linked_user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "anesthesiologists" ADD CONSTRAINT "anesthesiologists_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "consumables" ADD CONSTRAINT "consumables_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "contract_entities" ADD CONSTRAINT "contract_entities_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_fixed_hospital_id_hospitals_id_fk" FOREIGN KEY ("fixed_hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "financial_item_catalog" ADD CONSTRAINT "financial_item_catalog_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "hospitals" ADD CONSTRAINT "hospitals_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "hospitals" ADD CONSTRAINT "hospitals_contract_entity_id_contract_entities_id_fk" FOREIGN KEY ("contract_entity_id") REFERENCES "public"."contract_entities"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "technicians" ADD CONSTRAINT "technicians_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "technicians" ADD CONSTRAINT "technicians_linked_user_id_users_id_fk" FOREIGN KEY ("linked_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "anesthesiologists_current_name_unique" ON "anesthesiologists" USING btree ("normalized_name") WHERE "anesthesiologists"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "anesthesiologists_name_search_idx" ON "anesthesiologists" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "consumables_current_name_unique" ON "consumables" USING btree ("normalized_name") WHERE "consumables"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "consumables_name_search_idx" ON "consumables" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_entities_current_name_unique" ON "contract_entities" USING btree ("normalized_name") WHERE "contract_entities"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "contract_entities_name_search_idx" ON "contract_entities" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "doctors_current_name_unique" ON "doctors" USING btree ("normalized_name") WHERE "doctors"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "doctors_name_search_idx" ON "doctors" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_current_name_unique" ON "equipment" USING btree ("normalized_name") WHERE "equipment"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "equipment_name_search_idx" ON "equipment" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "equipment_fixed_hospital_idx" ON "equipment" USING btree ("fixed_hospital_id");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_item_catalog_current_name_unique" ON "financial_item_catalog" USING btree ("normalized_name") WHERE "financial_item_catalog"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "financial_item_catalog_name_search_idx" ON "financial_item_catalog" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "hospitals_current_name_unique" ON "hospitals" USING btree ("normalized_name") WHERE "hospitals"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "hospitals_name_search_idx" ON "hospitals" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "hospitals_contract_entity_idx" ON "hospitals" USING btree ("contract_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "procedures_current_name_unique" ON "procedures" USING btree ("normalized_name") WHERE "procedures"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "procedures_name_search_idx" ON "procedures" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "technicians_current_name_unique" ON "technicians" USING btree ("normalized_name") WHERE "technicians"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "technicians_name_search_idx" ON "technicians" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "technicians_linked_user_idx" ON "technicians" USING btree ("linked_user_id");