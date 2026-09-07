INSERT INTO permissions(code,module,label)
VALUES ('accounting.review.layout.manage','accounting','إدارة إعداد جدول المراجعة')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='owner' AND p.code='accounting.review.layout.manage'
ON CONFLICT DO NOTHING;
