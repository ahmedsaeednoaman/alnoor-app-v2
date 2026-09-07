/*
 * 0028 and 0029 exist outside the Drizzle journal in deployed history.
 * Keep this migration independently safe on both reconciled and fresh databases:
 * supply DDL is repeated with IF NOT EXISTS; no historical movement is replaced.
 */
DO $$ BEGIN
  CREATE TYPE "doctor_supply_source_type" AS ENUM ('consumable','stent','equipment','manual');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "doctor_supply_issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "doctor_id" uuid NOT NULL REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "occurred_at" timestamp with time zone NOT NULL,
  "notes" text,
  "idempotency_key" varchar(120) NOT NULL,
  "reversed" boolean DEFAULT false NOT NULL,
  "created_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "doctor_supply_issues_idempotency_unique" ON "doctor_supply_issues" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "doctor_supply_issues_doctor_idx" ON "doctor_supply_issues" ("doctor_id");
CREATE INDEX IF NOT EXISTS "doctor_supply_issues_occurred_at_idx" ON "doctor_supply_issues" ("occurred_at");
CREATE INDEX IF NOT EXISTS "doctor_supply_issues_doctor_occurred_at_idx" ON "doctor_supply_issues" ("doctor_id","occurred_at");

CREATE TABLE IF NOT EXISTS "doctor_supply_issue_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "issue_id" uuid NOT NULL REFERENCES "doctor_supply_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "source_type" "doctor_supply_source_type" NOT NULL,
  "source_reference_id" uuid,
  "item_name_snapshot" varchar(240) NOT NULL,
  "quantity" numeric(12,2) NOT NULL,
  "unit_price" numeric(12,2) NOT NULL,
  "total_amount" numeric(14,2) NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "doctor_supply_issue_items_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "doctor_supply_issue_items_unit_price_nonnegative" CHECK ("unit_price" >= 0),
  CONSTRAINT "doctor_supply_issue_items_total_nonnegative" CHECK ("total_amount" >= 0),
  CONSTRAINT "doctor_supply_issue_items_sort_order_nonnegative" CHECK ("sort_order" >= 0),
  CONSTRAINT "doctor_supply_issue_items_source_reference_check" CHECK (
    "source_type" = 'manual' OR ("source_type" <> 'manual' AND "source_reference_id" IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS "doctor_supply_issue_items_issue_idx" ON "doctor_supply_issue_items" ("issue_id");
CREATE INDEX IF NOT EXISTS "doctor_supply_issue_items_source_idx" ON "doctor_supply_issue_items" ("source_type","source_reference_id");
CREATE INDEX IF NOT EXISTS "doctor_supply_issue_items_issue_sort_idx" ON "doctor_supply_issue_items" ("issue_id","sort_order");

ALTER TABLE "doctor_account_postings" ADD COLUMN IF NOT EXISTS "case_name_snapshot" varchar(250);
ALTER TABLE "doctor_account_postings" ADD COLUMN IF NOT EXISTS "operation_type_snapshot" "operation_type";
ALTER TABLE "doctor_account_postings" ADD COLUMN IF NOT EXISTS "doctor_name_snapshot" varchar(200);
ALTER TABLE "doctor_account_postings" ADD COLUMN IF NOT EXISTS "reference_amount_snapshot" numeric(12,2);
ALTER TABLE "doctor_account_postings" ADD COLUMN IF NOT EXISTS "difference_amount_snapshot" numeric(12,2);

/*
 * Legacy fallback is based only on persisted operation/review/item rows.
 * COALESCE never overwrites an already authoritative snapshot. A missing
 * operation/review relationship leaves financial snapshots NULL.
 */
WITH legacy AS (
  SELECT p.id,
         o.case_name,
         o.type,
         d.name doctor_name,
         CASE
           WHEN fr.accounting_mode='main_amount' THEN fr.main_amount
           WHEN fr.accounting_mode='direct_items' THEN (
             SELECT sum(
               CASE WHEN i.kind='financial'
                          AND i.case_line_state='included'
                          AND i.financial_effect IN ('add','subtract')
                 THEN coalesce(i.base_amount,i.effective_amount,i.amount,0)
                 ELSE 0 END
             )
             FROM operation_financial_items i
             WHERE i.review_id=fr.id
           )
           ELSE NULL
         END reference_amount
    FROM doctor_account_postings p
    JOIN operations o ON o.id=p.operation_id
    JOIN doctors d ON d.id=p.doctor_id
    JOIN operation_financial_reviews fr ON fr.id=p.review_id
)
UPDATE doctor_account_postings p
   SET case_name_snapshot=coalesce(p.case_name_snapshot,legacy.case_name),
       operation_type_snapshot=coalesce(p.operation_type_snapshot,legacy.type),
       doctor_name_snapshot=coalesce(p.doctor_name_snapshot,legacy.doctor_name),
       reference_amount_snapshot=coalesce(p.reference_amount_snapshot,legacy.reference_amount),
       difference_amount_snapshot=coalesce(
         p.difference_amount_snapshot,
         CASE WHEN legacy.reference_amount IS NULL THEN NULL ELSE p.amount-legacy.reference_amount END
       )
  FROM legacy
 WHERE p.id=legacy.id;
