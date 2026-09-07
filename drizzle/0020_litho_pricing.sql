CREATE TABLE IF NOT EXISTS "lithotripsy_pricing_definitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "stable_key" varchar(120) NOT NULL UNIQUE,
  "label" varchar(180) NOT NULL,
  "category" varchar(40) NOT NULL,
  "source_type" varchar(60),
  "source_reference_id" uuid,
  "session_value" integer,
  "default_amount" numeric(12,2),
  "effect" "work_form_financial_effect" DEFAULT 'subtract' NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "litho_pricing_active_idx" ON "lithotripsy_pricing_definitions" ("active", "sort_order");
