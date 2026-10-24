-- The patient, named when the consultation is created (owner, 24 October 2026: on Home "we see only
-- the random number generated for that record"). Two optional fields; the consultation and its
-- patient are saved together or not at all, and a patient seen before is recognised by phone or email.
drop function public.create_consultation(timestamptz, public.consultation_language, boolean, text, int, text);

create function public.create_consultation(
  p_scheduled_at timestamptz,
  p_language public.consultation_language,
  p_consent_recorded boolean,
  p_scenario_notes text default '',
  p_fee_cents int default null,
  p_synthetic_patient_ref text default null,
  p_patient_name text default null,
  p_patient_contact text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_consultation public.consultations;
  v_patient jsonb;
  v_status public.consultation_status :=
    case when p_consent_recorded then 'ready_for_audio' else 'consent_pending' end;
begin
  if v_user is null then
    return private.refuse('NOT_SIGNED_IN');
  end if;
  if private.is_engine() then
    return private.refuse('NOT_A_PRACTITIONER');
  end if;
  if p_synthetic_patient_ref is not null and p_synthetic_patient_ref !~ '^SYN-[0-9]{1,8}$' then
    return private.refuse('VALIDATION', 'synthetic_patient_ref');
  end if;
  if p_scheduled_at is null then
    return private.refuse('VALIDATION', 'scheduled_at');
  end if;
  if char_length(coalesce(p_scenario_notes, '')) > 500 then
    return private.refuse('VALIDATION', 'scenario_notes');
  end if;
  if p_fee_cents is not null and p_fee_cents not between 50 and 100000 then
    return private.refuse('VALIDATION', 'fee_cents');
  end if;
  -- The patient's name and phone or email come together, or neither (the patient then gives them).
  if (nullif(btrim(coalesce(p_patient_name, '')), '') is null) <> (nullif(btrim(coalesce(p_patient_contact, '')), '') is null) then
    return private.refuse('VALIDATION', 'patient');
  end if;

  begin
    insert into public.consultations (
      practitioner_id, synthetic_patient_ref, scheduled_at, language, status,
      consent_recorded_at, consent_recorded_by, scenario_notes, fee_cents
    ) values (
      v_user, coalesce(p_synthetic_patient_ref, private.new_reference()), p_scheduled_at, p_language, v_status,
      case when p_consent_recorded then now() end,
      case when p_consent_recorded then v_user end,
      coalesce(p_scenario_notes, ''), p_fee_cents
    ) returning * into v_consultation;
    if nullif(btrim(coalesce(p_patient_name, '')), '') is not null then
      v_patient := private.identify_patient(v_consultation, p_patient_name, p_patient_contact);
      if not (v_patient ->> 'ok')::boolean then
        raise exception using errcode = 'W0001'; -- undoes the consultation above
      end if;
    end if;
  exception when sqlstate 'W0001' then
    return v_patient;
  end;

  perform private.log_event(v_consultation.id, 'consultation.created', v_user::text, 'practitioner',
    'consultation', v_consultation.id, 'success', jsonb_build_object('to_status', v_status));
  if p_consent_recorded then
    perform private.log_event(v_consultation.id, 'consent.recorded', v_user::text, 'practitioner',
      'consultation', v_consultation.id, 'success');
  end if;
  return jsonb_build_object('ok', true, 'consultation_id', v_consultation.id);
end;
$$;

revoke all on function public.create_consultation(timestamptz, public.consultation_language, boolean, text, int, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_consultation(timestamptz, public.consultation_language, boolean, text, int, text, text, text)
  to authenticated;
