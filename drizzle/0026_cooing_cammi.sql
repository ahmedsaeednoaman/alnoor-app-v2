ALTER TABLE "service_pricing_items" ADD COLUMN "stable_key" varchar(180) NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "service_pricing_items_active_key_unique" ON "service_pricing_items" USING btree ("profile_id","stable_key") WHERE "service_pricing_items"."active" = true;
--> statement-breakpoint
INSERT INTO "permissions" ("code","module","label") VALUES
 ('accounting.contract.pricing.manage','accounting','إدارة أسعار التعاقد'),
 ('accounting.endoscopy.pricing.manage','accounting','إدارة أسعار المناظير')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id","permission_id")
SELECT r.id,p.id FROM "roles" r CROSS JOIN "permissions" p
WHERE r.code IN ('owner','accountant') AND p.code IN ('accounting.contract.pricing.manage','accounting.endoscopy.pricing.manage')
ON CONFLICT DO NOTHING;
