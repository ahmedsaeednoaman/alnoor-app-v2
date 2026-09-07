-- Custom SQL migration file, put your code below! --
INSERT INTO anesthesia_types(name, normalized_name, created_by_user_id)
SELECT seed.name, seed.name, users.id
FROM (VALUES ('نصفي'::varchar), ('كلي'::varchar)) AS seed(name)
JOIN LATERAL (SELECT id FROM users WHERE archived_at IS NULL ORDER BY created_at LIMIT 1) users ON true
WHERE NOT EXISTS (SELECT 1 FROM anesthesia_types existing WHERE existing.normalized_name = seed.name AND existing.archived_at IS NULL);

UPDATE work_form_fields
SET field_type = 'smart_single', smart_dropdown_source = 'anesthesia_types', multiple = false,
    min_selections = null, max_selections = null
WHERE stable_key = 'anesthesia_type'
  AND template_id IN (SELECT id FROM work_form_templates WHERE status = 'published');
