CREATE TABLE IF NOT EXISTS "doctor_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "doctor_id" uuid NOT NULL,
  "amount" numeric(12, 2) NOT NULL,
  "paid_at" timestamp with time zone NOT NULL,
  "notes" text,
  "idempotency_key" varchar(120) NOT NULL,
  "reversed" boolean DEFAULT false NOT NULL,
  "created_by_user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "doctor_payments_amount_positive"
    CHECK ("amount" > 0),

  CONSTRAINT "doctor_payments_doctor_fk"
    FOREIGN KEY ("doctor_id")
    REFERENCES "doctors"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  CONSTRAINT "doctor_payments_created_by_fk"
    FOREIGN KEY ("created_by_user_id")
    REFERENCES "users"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "doctor_payments_idempotency_unique"
ON "doctor_payments" ("idempotency_key");

CREATE INDEX IF NOT EXISTS "doctor_payments_doctor_idx"
ON "doctor_payments" ("doctor_id");

CREATE INDEX IF NOT EXISTS "doctor_payments_paid_at_idx"
ON "doctor_payments" ("paid_at");


CREATE TABLE IF NOT EXISTS "doctor_account_adjustments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "doctor_id" uuid NOT NULL,
  "direction" varchar(10) NOT NULL,
  "amount" numeric(12, 2) NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "description" varchar(300) NOT NULL,
  "notes" text,
  "idempotency_key" varchar(120) NOT NULL,
  "reversed" boolean DEFAULT false NOT NULL,
  "created_by_user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "doctor_adjustment_direction_check"
    CHECK ("direction" IN ('debit', 'credit')),

  CONSTRAINT "doctor_adjustment_amount_positive"
    CHECK ("amount" > 0),

  CONSTRAINT "doctor_adjustments_doctor_fk"
    FOREIGN KEY ("doctor_id")
    REFERENCES "doctors"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  CONSTRAINT "doctor_adjustments_created_by_fk"
    FOREIGN KEY ("created_by_user_id")
    REFERENCES "users"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "doctor_account_adjustments_idempotency_unique"
ON "doctor_account_adjustments" ("idempotency_key");

CREATE INDEX IF NOT EXISTS "doctor_account_adjustments_doctor_idx"
ON "doctor_account_adjustments" ("doctor_id");

CREATE INDEX IF NOT EXISTS "doctor_account_adjustments_occurred_at_idx"
ON "doctor_account_adjustments" ("occurred_at");