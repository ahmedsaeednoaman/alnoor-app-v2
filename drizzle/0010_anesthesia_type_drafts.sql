-- Custom SQL migration file, put your code below! --
UPDATE work_form_fields
SET field_type = 'smart_single', smart_dropdown_source = 'anesthesia_types', multiple = false,
    min_selections = null, max_selections = null
WHERE stable_key = 'anesthesia_type'
  AND template_id IN (SELECT id FROM work_form_templates WHERE status = 'draft');
