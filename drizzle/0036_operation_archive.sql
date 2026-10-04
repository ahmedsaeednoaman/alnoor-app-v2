CREATE TABLE "operation_archive_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" varchar(16) NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_archive_events_action_valid" CHECK ("operation_archive_events"."action" in ('archive','restore'))
);
--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "archived_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "archive_reason" text;--> statement-breakpoint
ALTER TABLE "operation_archive_events" ADD CONSTRAINT "operation_archive_events_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "operation_archive_events" ADD CONSTRAINT "operation_archive_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "operation_archive_events_operation_time_idx" ON "operation_archive_events" USING btree ("operation_id","occurred_at");--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_archived_by_user_id_users_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "operations_archived_at_idx" ON "operations" USING btree ("archived_at");--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_archive_metadata_valid" CHECK (("operations"."archived_at" is null and "operations"."archived_by_user_id" is null and "operations"."archive_reason" is null) or ("operations"."archived_at" is not null and "operations"."archived_by_user_id" is not null));
--> statement-breakpoint
INSERT INTO permissions(code,module,label) VALUES ('operations.archive','operations','أرشفة واستعادة العمليات') ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code='owner' AND p.code='operations.archive'
ON CONFLICT DO NOTHING;
