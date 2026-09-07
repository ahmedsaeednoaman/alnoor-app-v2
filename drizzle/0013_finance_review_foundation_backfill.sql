UPDATE work_form_fields
SET review_role = CASE
  WHEN stable_key IN ('anesthesiologist','technician','equipment','consumables','stents') THEN 'cost_source'::work_form_review_role
  WHEN stable_key IN ('case_name','doctor','hospital','operation_date','operation_time','procedures','side','anesthesia_type','session_count','participants','notes','contract_entity','reference_number') THEN 'context'::work_form_review_role
  ELSE review_role
END;
UPDATE work_form_fields SET review_role='cost_source'::work_form_review_role WHERE is_financial=true AND review_role='hidden'::work_form_review_role;

DO $$
DECLARE t RECORD; s UUID; next_order INTEGER;
BEGIN
  FOR t IN SELECT id FROM work_form_templates WHERE operation_type='lithotripsy'::operation_type LOOP
    SELECT id INTO s FROM work_form_sections WHERE template_id=t.id AND stable_key='procedures_equipment' AND archived_at IS NULL LIMIT 1;
    IF s IS NOT NULL AND NOT EXISTS (SELECT 1 FROM work_form_fields WHERE template_id=t.id AND stable_key='stents') THEN
      SELECT coalesce(max(sort_order),-1)+1 INTO next_order FROM work_form_fields WHERE section_id=s AND archived_at IS NULL;
      INSERT INTO work_form_fields(template_id,section_id,stable_key,label,field_type,required,multiple,sort_order,is_system_field,smart_dropdown_source,min_selections,max_selections,show_in_form,show_in_details,show_in_financial_review,review_role,show_in_print,is_financial,financial_effect)
      VALUES(t.id,s,'stents','الدعامات','smart_multi',false,true,next_order,true,'stents'::work_form_reference_source,0,NULL,true,true,false,'cost_source'::work_form_review_role,false,false,NULL);
    END IF;
  END LOOP;
END $$;
