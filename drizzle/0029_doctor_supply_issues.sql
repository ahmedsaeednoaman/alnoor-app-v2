DO $$ BEGIN
  CREATE TYPE "doctor_supply_source_type" AS ENUM (
    'consumable',
    'stent',
    'equipment',
    'manual'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


CREATE TABLE IF NOT EXISTS "doctor_supply_issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  "doctor_id" uuid NOT NULL,

  "occurred_at" timestamp with time zone NOT NULL,

  "notes" text,

  "idempotency_key" varchar(120) NOT NULL,

  "reversed" boolean DEFAULT false NOT NULL,

  "created_by_user_id" uuid NOT NULL,

  "created_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "doctor_supply_issues_doctor_fk"
    FOREIGN KEY ("doctor_id")
    REFERENCES "doctors"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  CONSTRAINT "doctor_supply_issues_created_by_fk"
    FOREIGN KEY ("created_by_user_id")
    REFERENCES "users"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE
);


CREATE UNIQUE INDEX IF NOT EXISTS "doctor_supply_issues_idempotency_unique"
ON "doctor_supply_issues" ("idempotency_key");


CREATE INDEX IF NOT EXISTS "doctor_supply_issues_doctor_idx"
ON "doctor_supply_issues" ("doctor_id");


CREATE INDEX IF NOT EXISTS "doctor_supply_issues_occurred_at_idx"
ON "doctor_supply_issues" ("occurred_at");


CREATE INDEX IF NOT EXISTS "doctor_supply_issues_doctor_occurred_at_idx"
ON "doctor_supply_issues" ("doctor_id", "occurred_at");


CREATE TABLE IF NOT EXISTS "doctor_supply_issue_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  "issue_id" uuid NOT NULL,

  "source_type" "doctor_supply_source_type" NOT NULL,

  /*
   * UUID of the original catalog record.
   *
   * This intentionally has no direct FK because the UUID may belong to:
   * - consumables
   * - stents
   * - equipment
   *
   * source_type tells us which catalog owns the UUID.
   *
   * manual items may leave this NULL.
   */
  "source_reference_id" uuid,

  /*
   * Historical snapshot.
   * Never re-resolve the current catalog name when displaying
   * an old doctor-account movement.
   */
  "item_name_snapshot" varchar(240) NOT NULL,

  "quantity" numeric(12, 2) NOT NULL,

  /*
   * Historical price at the exact moment the doctor received
   * the item.
   */
  "unit_price" numeric(12, 2) NOT NULL,

  /*
   * Historical final line amount.
   * The server will normally calculate:
   *
   * quantity × unit_price
   *
   * and save the result here.
   */
  "total_amount" numeric(14, 2) NOT NULL,

  "sort_order" integer DEFAULT 0 NOT NULL,

  "notes" text,

  "created_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "doctor_supply_issue_items_issue_fk"
    FOREIGN KEY ("issue_id")
    REFERENCES "doctor_supply_issues"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,

  CONSTRAINT "doctor_supply_issue_items_quantity_positive"
    CHECK ("quantity" > 0),

  CONSTRAINT "doctor_supply_issue_items_unit_price_nonnegative"
    CHECK ("unit_price" >= 0),

  CONSTRAINT "doctor_supply_issue_items_total_nonnegative"
    CHECK ("total_amount" >= 0),

  CONSTRAINT "doctor_supply_issue_items_sort_order_nonnegative"
    CHECK ("sort_order" >= 0),

  CONSTRAINT "doctor_supply_issue_items_source_reference_check"
    CHECK (
      (
        "source_type" = 'manual'
      )
      OR
      (
        "source_type" <> 'manual'
        AND "source_reference_id" IS NOT NULL
      )
    )
);


CREATE INDEX IF NOT EXISTS "doctor_supply_issue_items_issue_idx"
ON "doctor_supply_issue_items" ("issue_id");


CREATE INDEX IF NOT EXISTS "doctor_supply_issue_items_source_idx"
ON "doctor_supply_issue_items" (
  "source_type",
  "source_reference_id"
);


CREATE INDEX IF NOT EXISTS "doctor_supply_issue_items_issue_sort_idx"
ON "doctor_supply_issue_items" (
  "issue_id",
  "sort_order"
);