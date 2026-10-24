-- Making a consultation free (owner, 24 October 2026: "when a doctor creates a consultation he
-- should be able to put any price including 0 and when its 0 the payment needs to be bypassed";
-- unpaid consultations get a "Make it free" button). The fee goes; a booked time no longer waits
-- for the payment. A booking whose wait ran out takes its time back, unless someone booked it since.
create function public.make_consultation_free(p_consultation_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_consultation public.consultations;
begin
  -- The same lock as book_time and renew_hold, taken first, so a booking cannot take the time meanwhile.
  perform 1 from public.practitioner_profiles where practitioner_id = v_user for update;
  select * into v_consultation from public.consultations
    where id = p_consultation_id and practitioner_id = v_user for update;
  if not found then
    return private.refuse('NOT_FOUND');
  end if;
  if v_consultation.paid_at is not null then
    return private.refuse('INVALID_STATE_TRANSITION');
  end if;
  if v_consultation.fee_cents is null then
    return jsonb_build_object('ok', true);
  end if;
  if public.released(v_consultation) and private.time_blocked(v_user, v_consultation.scheduled_at,
       v_consultation.scheduled_at + make_interval(mins => v_consultation.duration_minutes), v_consultation.id) then
    return private.refuse('TIME_TAKEN');
  end if;
  update public.consultations set fee_cents = null, hold_until = null, updated_at = now()
    where id = p_consultation_id;
  perform private.log_event(p_consultation_id, 'fee.waived', v_user::text, 'practitioner',
    'consultation', p_consultation_id, 'success');
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.make_consultation_free(uuid) from public, anon, service_role;
grant execute on function public.make_consultation_free(uuid) to authenticated;
