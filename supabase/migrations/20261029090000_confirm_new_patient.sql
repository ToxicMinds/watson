-- "Is this your patient?" (owner, 28 Oct 2026). What is typed for a consultation, by the patient when
-- booking or on their link, or by the practitioner (owner, 29 Oct: ask first), is a claim (SEC-02).
-- When nobody among the practitioner's patients has that phone or email, the practitioner adds them as
-- a new patient with one press; when somebody does, the practitioner answers "same person?"
-- through patient_review_association instead, so a typed contact never joins an existing record unchecked.
create function public.confirm_new_patient(p_consultation_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_consultation public.consultations;
  v_patient uuid;
begin
  if not private.is_practitioner() or private.is_engine() then
    return private.refuse('NOT_A_PRACTITIONER');
  end if;
  select * into v_consultation from public.consultations
  where id = p_consultation_id and practitioner_id = v_user for update;
  if not found then return private.refuse('NOT_FOUND'); end if;
  if v_consultation.patient_association_state <> 'claimed' or v_consultation.patient_claim_name is null then
    return private.refuse('NOT_A_CLAIM');
  end if;
  if exists (
    select 1 from public.patients p where p.practitioner_id = v_user
      and (p.phone = v_consultation.patient_claim_phone or p.email = v_consultation.patient_claim_email)
  ) then
    return private.refuse('PATIENT_EXISTS');
  end if;

  insert into public.patients (practitioner_id, name, phone, email)
  values (v_user, v_consultation.patient_claim_name, v_consultation.patient_claim_phone, v_consultation.patient_claim_email)
  returning id into v_patient;
  update public.consultations set patient_id = v_patient,
    patient_association_state = 'practitioner_confirmed', patient_associated_at = now(),
    patient_associated_by = v_user, updated_at = now()
  where id = p_consultation_id;
  perform private.log_event(p_consultation_id, 'patient.association_confirmed', v_user::text,
    'practitioner', 'consultation', p_consultation_id, 'success', '{}'::jsonb);
  return jsonb_build_object('ok', true, 'patient_id', v_patient, 'association_state', 'practitioner_confirmed');
end;
$$;
revoke all on function public.confirm_new_patient(uuid) from public, anon, service_role;
grant execute on function public.confirm_new_patient(uuid) to authenticated;

-- The practitioner names the patient under Documents ("Save patient"). Like everything typed for a
-- consultation, it is a claim that "Is this your patient?" then confirms (owner, 29 Oct: ask first, even
-- for the practitioner's own typing). Once a patient is confirmed, "Change" corrects the practitioner's
-- own record instead, which a claim could not do (identify_patient refuses: ASSOCIATION_LOCKED).
create or replace function public.set_patient(p_consultation_id uuid, p_name text, p_contact text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_consultation public.consultations;
begin
  if not private.is_practitioner() or private.is_engine() then
    return private.refuse('NOT_A_PRACTITIONER');
  end if;
  select * into v_consultation from public.consultations
    where id = p_consultation_id and practitioner_id = v_user for update;
  if not found then return private.refuse('NOT_FOUND'); end if;
  if v_consultation.patient_id is null
    or v_consultation.patient_association_state not in ('verified', 'practitioner_confirmed') then
    return private.identify_patient(v_consultation, p_name, p_contact);
  end if;

  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 120 then
    return private.refuse('VALIDATION', 'name');
  end if;
  if private.normal_email(p_contact) is null and private.normal_phone(p_contact) is null then
    return private.refuse('VALIDATION', 'contact');
  end if;
  begin
    update public.patients set name = btrim(p_name),
      phone = case when position('@' in p_contact) > 0 then null else private.normal_phone(p_contact) end,
      email = case when position('@' in p_contact) > 0 then private.normal_email(p_contact) end
    where id = v_consultation.patient_id and practitioner_id = v_user;
  exception when unique_violation then
    return private.refuse('PATIENT_EXISTS');
  end;
  return jsonb_build_object('ok', true);
end;
$$;
