-- SEC-02: submitted identity is a consultation-scoped claim. It never proves
-- ownership of a canonical patient row without an admitted OTP session or the
-- consultation's practitioner explicitly confirming the association.

alter table public.consultations
  add column patient_claim_name text check (patient_claim_name is null or char_length(patient_claim_name) between 1 and 120),
  add column patient_claim_phone text check (patient_claim_phone is null or patient_claim_phone ~ '^\+[1-9][0-9]{6,14}$'),
  add column patient_claim_email text check (patient_claim_email is null or (patient_claim_email = lower(patient_claim_email) and char_length(patient_claim_email) <= 254)),
  add column patient_claim_updated_at timestamptz,
  add column patient_association_state text not null default 'unclaimed'
    check (patient_association_state in ('unclaimed', 'claimed', 'legacy_unverified', 'verified', 'practitioner_confirmed', 'rejected')),
  add column patient_associated_at timestamptz,
  add column patient_associated_by uuid references auth.users(id) on delete set null,
  -- UUID only: a second FK to patients would make PostgREST's `patients(...)`
  -- relationship ambiguous. This value is quarantine evidence, not a live join.
  add column legacy_patient_id uuid,
  add constraint consultation_claim_contact check (
    (patient_claim_phone is null or patient_claim_email is null)
    and ((patient_claim_phone is null and patient_claim_email is null) = (patient_claim_name is null))
  );

-- Existing links were established from unverified bearer-link input. Preserve
-- the old target for practitioner review, but remove it from every live join.
update public.consultations
set legacy_patient_id = patient_id,
    patient_id = null,
    patient_association_state = 'legacy_unverified'
where patient_id is not null;

create index consultations_claim_phone
  on public.consultations(practitioner_id, patient_claim_phone)
  where patient_claim_phone is not null;
create index consultations_claim_email
  on public.consultations(practitioner_id, patient_claim_email)
  where patient_claim_email is not null;

alter table private.patient_otp_sessions
  add column verified_email text check (verified_email is null or (verified_email = lower(verified_email) and char_length(verified_email) <= 254)),
  add column verified_phone text check (verified_phone is null or verified_phone ~ '^\+[1-9][0-9]{6,14}$');

-- Old admitted sessions did not record which contact was proved. Fail them
-- closed; users can establish a new admitted session with another OTP.
delete from private.patient_otp_sessions;
alter table private.patient_otp_sessions
  add constraint patient_otp_session_one_contact check ((verified_email is null) <> (verified_phone is null));

drop function public.register_patient_otp_session(uuid, uuid);
create function public.register_patient_otp_session(
  p_user_id uuid, p_session_id uuid, p_verified_email text, p_verified_phone text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := private.normal_email(p_verified_email);
  v_phone text := private.normal_phone(p_verified_phone);
begin
  if p_user_id is null or p_session_id is null or ((v_email is null) = (v_phone is null)) then
    return private.refuse('VALIDATION');
  end if;
  if not exists (
    select 1 from private.user_roles r where r.user_id = p_user_id and r.role = 'patient'
  ) or not exists (
    select 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_user_id
  ) then return private.refuse('SESSION_INVALID'); end if;
  if not exists (
    select 1 from auth.users u where u.id = p_user_id
      and ((v_email is not null and lower(u.email) = v_email and u.email_confirmed_at is not null)
        or (v_phone is not null and u.phone = v_phone and u.phone_confirmed_at is not null))
  ) then return private.refuse('CONTACT_UNVERIFIED'); end if;

  insert into private.patient_otp_sessions(session_id, user_id, verified_email, verified_phone)
  values (p_session_id, p_user_id, v_email, v_phone)
  on conflict (session_id) do update set
    user_id = excluded.user_id,
    verified_email = excluded.verified_email,
    verified_phone = excluded.verified_phone,
    created_at = now();
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.register_patient_otp_session(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.register_patient_otp_session(uuid, uuid, text, text) to service_role;

create table private.patient_auth_associations (
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  practitioner_id uuid not null references auth.users(id) on delete restrict,
  patient_id uuid not null unique references public.patients(id) on delete restrict,
  verified_contact_kind text not null check (verified_contact_kind in ('email', 'phone')),
  verified_contact text not null,
  created_at timestamptz not null default now(),
  primary key (auth_user_id, practitioner_id)
);
revoke all on private.patient_auth_associations from public, anon, authenticated, service_role;

-- Replaces the old canonical matcher. The caller must hold the consultation row
-- lock. Existing verified associations are immutable through a bearer link.
create or replace function private.identify_patient(
  p_consultation public.consultations, p_name text, p_contact text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text;
  v_email text;
begin
  if char_length(v_name) not between 1 and 120 then
    return private.refuse('VALIDATION', 'name');
  end if;
  if position('@' in coalesce(p_contact, '')) > 0 then
    v_email := private.normal_email(p_contact);
  else
    v_phone := private.normal_phone(p_contact);
  end if;
  if v_phone is null and v_email is null then
    return private.refuse('VALIDATION', 'contact');
  end if;

  if p_consultation.patient_association_state in ('verified', 'practitioner_confirmed') then
    if p_consultation.patient_claim_name = v_name
      and p_consultation.patient_claim_phone is not distinct from v_phone
      and p_consultation.patient_claim_email is not distinct from v_email then
      return jsonb_build_object('ok', true);
    end if;
    return private.refuse('ASSOCIATION_LOCKED');
  end if;

  update public.consultations set
    patient_claim_name = v_name,
    patient_claim_phone = v_phone,
    patient_claim_email = v_email,
    patient_claim_updated_at = now(),
    patient_id = null,
    patient_association_state = 'claimed',
    patient_associated_at = null,
    patient_associated_by = null,
    updated_at = now()
  where id = p_consultation.id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function private.identify_patient(public.consultations, text, text) from public, anon, authenticated, service_role;

create or replace function public.patient_identify(p_token text, p_name text, p_contact text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_consultation public.consultations;
begin
  select * into v_consultation from public.consultations
  where id = (select id from private.consultation_for_token(p_token)) for update;
  if not found then return private.refuse('NOT_FOUND'); end if;
  return private.identify_patient(v_consultation, p_name, p_contact);
end;
$$;
revoke all on function public.patient_identify(text, text, text) from public;
grant execute on function public.patient_identify(text, text, text) to anon, authenticated, service_role;

create or replace function public.invite_details(p_token text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('ok', true, 'scheduled_at', c.scheduled_at, 'fee_cents', c.fee_cents,
              'currency', 'eur', 'paid', c.paid_at is not null, 'paid_at', c.paid_at,
              'whatsapp_code', c.whatsapp_code,
              'booked_from', case when c.booked_at is not null then
                (select p.slug from public.practitioner_profiles p where p.practitioner_id = c.practitioner_id) end,
              'patient', case when c.patient_claim_name is not null then jsonb_build_object(
                'name', c.patient_claim_name, 'contact', coalesce(c.patient_claim_phone, c.patient_claim_email)) end,
              'documents', (select coalesce(jsonb_agg(jsonb_build_object(
                                  'id', d.id, 'file_name', d.file_name, 'media_type', d.media_type,
                                  'size_bytes', d.size_bytes, 'created_at', d.created_at,
                                  'removed_at', d.removed_at, 'cleanup_completed_at', d.cleanup_completed_at)
                                order by d.created_at), '[]'::jsonb)
                              from public.patient_documents d
                              where d.consultation_id = c.id
                                and (d.uploaded_at is not null or d.removed_at is not null)))
      from private.consultation_for_token(p_token) c where c.id is not null),
    private.refuse('NOT_FOUND'));
$$;
revoke all on function public.invite_details(text) from public;
grant execute on function public.invite_details(text) to anon, authenticated, service_role;

create function public.patient_link_consultation(p_token text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_session uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
  v_verified_email text;
  v_verified_phone text;
  v_consultation public.consultations;
  v_patient uuid;
  v_existing uuid;
begin
  if not private.has_role('patient') then return private.refuse('NOT_A_PATIENT'); end if;
  select s.verified_email, s.verified_phone into v_verified_email, v_verified_phone
  from private.patient_otp_sessions s where s.user_id = v_user and s.session_id = v_session;
  if not found then return private.refuse('CONTACT_UNVERIFIED'); end if;

  select * into v_consultation from public.consultations
  where id = (select id from private.consultation_for_token(p_token)) for update;
  if not found then return private.refuse('NOT_FOUND'); end if;
  if v_consultation.patient_claim_name is null then return private.refuse('CLAIM_REQUIRED'); end if;
  if not ((v_verified_email is not null and v_verified_email = v_consultation.patient_claim_email)
    or (v_verified_phone is not null and v_verified_phone = v_consultation.patient_claim_phone)) then
    return private.refuse('CONTACT_MISMATCH');
  end if;

  select a.patient_id into v_existing from private.patient_auth_associations a
  where a.auth_user_id = v_user and a.practitioner_id = v_consultation.practitioner_id;
  if v_existing is not null then
    if v_consultation.patient_id is not null and v_existing <> v_consultation.patient_id then
      return private.refuse('ASSOCIATION_CONFLICT');
    end if;
    if not exists (select 1 from public.patients p where p.id = v_existing
      and ((v_verified_email is not null and p.email = v_verified_email)
        or (v_verified_phone is not null and p.phone = v_verified_phone))) then
      return private.refuse('ASSOCIATION_CONFLICT');
    end if;
    v_patient := v_existing;
  else
    if v_consultation.patient_id is not null
      and v_consultation.patient_association_state in ('verified', 'practitioner_confirmed') then
      if not exists (select 1 from public.patients p where p.id = v_consultation.patient_id
        and ((v_verified_email is not null and p.email = v_verified_email)
          or (v_verified_phone is not null and p.phone = v_verified_phone))) then
        return private.refuse('ASSOCIATION_CONFLICT');
      end if;
      v_patient := v_consultation.patient_id;
    else
      select p.id into v_patient from public.patients p
      where p.practitioner_id = v_consultation.practitioner_id
        and ((v_verified_email is not null and p.email = v_verified_email)
          or (v_verified_phone is not null and p.phone = v_verified_phone));
    end if;
    if v_patient is null then
      insert into public.patients(practitioner_id, name, phone, email)
      values (v_consultation.practitioner_id, v_consultation.patient_claim_name,
        v_consultation.patient_claim_phone, v_consultation.patient_claim_email)
      returning id into v_patient;
    end if;
    begin
      insert into private.patient_auth_associations(
        auth_user_id, practitioner_id, patient_id, verified_contact_kind, verified_contact
      ) values (
        v_user, v_consultation.practitioner_id, v_patient,
        case when v_verified_email is not null then 'email' else 'phone' end,
        coalesce(v_verified_email, v_verified_phone)
      );
    exception when unique_violation then
      select a.patient_id into v_existing from private.patient_auth_associations a
      where a.auth_user_id = v_user and a.practitioner_id = v_consultation.practitioner_id;
      if v_existing is null or v_existing <> v_patient then return private.refuse('ASSOCIATION_CONFLICT'); end if;
    end;
  end if;

  update public.consultations set patient_id = v_patient,
    patient_association_state = 'verified', patient_associated_at = now(),
    patient_associated_by = v_user, updated_at = now()
  where id = v_consultation.id;
  perform private.log_event(v_consultation.id, 'patient.association_verified', v_user::text,
    'patient', 'consultation', v_consultation.id, 'success', jsonb_build_object('source', 'otp'));
  return jsonb_build_object('ok', true, 'patient_id', v_patient, 'association_state', 'verified');
end;
$$;
revoke all on function public.patient_link_consultation(text) from public, anon, service_role;
grant execute on function public.patient_link_consultation(text) to authenticated;

create function public.patient_review_association(
  p_consultation_id uuid, p_patient_id uuid, p_decision text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if not private.is_practitioner() or private.is_engine() then
    return private.refuse('NOT_A_PRACTITIONER');
  end if;
  if p_decision not in ('confirm', 'reject') then return private.refuse('VALIDATION', 'decision'); end if;
  perform 1 from public.consultations
  where id = p_consultation_id and practitioner_id = v_user for update;
  if not found then return private.refuse('NOT_FOUND'); end if;

  if p_decision = 'reject' then
    update public.consultations set patient_id = null, patient_association_state = 'rejected',
      patient_associated_at = now(), patient_associated_by = v_user, updated_at = now()
    where id = p_consultation_id;
    perform private.log_event(p_consultation_id, 'patient.association_rejected', v_user::text,
      'practitioner', 'consultation', p_consultation_id, 'success', '{}'::jsonb);
    return jsonb_build_object('ok', true, 'association_state', 'rejected');
  end if;

  if p_patient_id is null or not exists (
    select 1 from public.patients p where p.id = p_patient_id and p.practitioner_id = v_user
  ) then return private.refuse('PATIENT_NOT_FOUND'); end if;
  update public.consultations set patient_id = p_patient_id,
    patient_association_state = 'practitioner_confirmed', patient_associated_at = now(),
    patient_associated_by = v_user, updated_at = now()
  where id = p_consultation_id;
  perform private.log_event(p_consultation_id, 'patient.association_confirmed', v_user::text,
    'practitioner', 'consultation', p_consultation_id, 'success', '{}'::jsonb);
  return jsonb_build_object('ok', true, 'patient_id', p_patient_id,
    'association_state', 'practitioner_confirmed');
end;
$$;
revoke all on function public.patient_review_association(uuid, uuid, text) from public, anon, service_role;
grant execute on function public.patient_review_association(uuid, uuid, text) to authenticated;

-- Booking still applies its existing contact-based hold budget (SEC-04 remains
-- separate), but that comparison is now against claims and cannot attach a row.
create or replace function public.book_time(
  p_slug text, p_starts_at timestamptz, p_name text, p_contact text,
  p_language public.consultation_language, p_remind_whatsapp boolean
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_page public.practitioner_profiles;
  v_consultation public.consultations;
  v_claim jsonb;
begin
  select * into v_page from public.practitioner_profiles where slug = p_slug for update;
  if not found then return private.refuse('NOT_FOUND'); end if;
  if p_language is null or not (p_language = any (v_page.languages)) then
    return private.refuse('VALIDATION', 'language');
  end if;
  if p_starts_at is null or not exists (
    select 1 from private.open_times(v_page, p_starts_at, p_starts_at + interval '1 minute') t
    where t.starts_at = p_starts_at
  ) then return private.refuse('TIME_TAKEN'); end if;

  begin
    insert into public.consultations (practitioner_id, synthetic_patient_ref, scheduled_at, duration_minutes,
      language, status, fee_cents, booked_at, hold_until, remind_whatsapp)
    values (v_page.practitioner_id, private.new_reference(), p_starts_at, v_page.length_minutes,
      p_language, 'consent_pending', v_page.fee_cents, now(),
      case when v_page.fee_cents is not null then now() + interval '35 minutes' end,
      coalesce(p_remind_whatsapp, false)) returning * into v_consultation;
    v_claim := private.identify_patient(v_consultation, p_name, p_contact);
    if (v_claim ->> 'ok')::boolean and (
      select count(*) from public.consultations c where c.id <> v_consultation.id
        and c.practitioner_id = v_page.practitioner_id
        and ((c.patient_claim_phone is not null and c.patient_claim_phone =
                (select patient_claim_phone from public.consultations where id = v_consultation.id))
          or (c.patient_claim_email is not null and c.patient_claim_email =
                (select patient_claim_email from public.consultations where id = v_consultation.id)))
        and c.scheduled_at > now() and private.takes_time(c)) >= 3 then
      v_claim := private.refuse('TOO_MANY_BOOKINGS');
    end if;
    if not (v_claim ->> 'ok')::boolean then raise exception using errcode = 'W0001'; end if;
  exception when sqlstate 'W0001' then return v_claim;
  end;
  perform private.log_event(v_consultation.id, 'consultation.booked', 'patient', 'patient',
    'consultation', v_consultation.id, 'success', jsonb_build_object('to_status', v_consultation.status));
  return jsonb_build_object('ok', true, 'token', v_consultation.invite_token);
end;
$$;
revoke all on function public.book_time(text, timestamptz, text, text, public.consultation_language, boolean) from public;
grant execute on function public.book_time(text, timestamptz, text, text, public.consultation_language, boolean)
  to anon, authenticated, service_role;

-- Practitioner and service views may use the submitted name for this
-- consultation. They must not fall back to a quarantined canonical identity.
create or replace function public.calendar_week(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_page public.practitioner_profiles;
begin
  if v_user is null then return private.refuse('NOT_SIGNED_IN'); end if;
  if not private.is_practitioner() or private.is_engine() then return private.refuse('NOT_A_PRACTITIONER'); end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '35 days' then
    return private.refuse('VALIDATION', 'range');
  end if;
  select * into v_page from public.practitioner_profiles where practitioner_id = v_user;
  return jsonb_build_object('ok', true,
    'page', case when v_page.practitioner_id is null then null else private.public_page(v_page)
      || jsonb_build_object('hours', v_page.hours, 'gap_minutes', v_page.gap_minutes) end,
    'open', case when v_page.practitioner_id is null then '[]'::jsonb else
      (select coalesce(jsonb_agg(t.starts_at order by t.starts_at), '[]'::jsonb)
       from private.open_times(v_page, p_from, p_to) t) end,
    'busy', (select coalesce(jsonb_agg(jsonb_build_object('starts_at', b.starts_at, 'ends_at', b.ends_at)
              order by b.starts_at), '[]'::jsonb) from public.busy_times b
             where b.practitioner_id = v_user
               and tstzrange(b.starts_at, b.ends_at) && tstzrange(p_from, p_to)),
    'bookings', (select coalesce(jsonb_agg(jsonb_build_object(
                   'consultation_id', c.id, 'starts_at', c.scheduled_at, 'minutes', c.duration_minutes,
                   'who', coalesce(c.patient_claim_name, p.name, c.synthetic_patient_ref),
                   'paid', case when c.fee_cents is null then null else c.paid_at is not null end,
                   'held', c.hold_until is not null and c.paid_at is null) order by c.scheduled_at), '[]'::jsonb)
                 from public.consultations c left join public.patients p on p.id = c.patient_id
                 where c.practitioner_id = v_user and private.takes_time(c)
                   and tstzrange(c.scheduled_at, c.scheduled_at + make_interval(mins => c.duration_minutes))
                     && tstzrange(p_from, p_to)),
    'google', (select jsonb_build_object('email', g.email, 'connected_at', g.connected_at,
                'checked_at', g.checked_at, 'problem', g.problem)
               from public.google_calendars g where g.practitioner_id = v_user));
end;
$$;

create or replace function public.google_events_due(p_practitioner uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('ok', true, 'events', coalesce(jsonb_agg(jsonb_build_object(
      'consultation_id', c.id, 'starts_at', c.scheduled_at, 'minutes', c.duration_minutes,
      'who', coalesce(c.patient_claim_name, p.name, c.synthetic_patient_ref)) order by c.scheduled_at), '[]'::jsonb))
  from public.consultations c left join public.patients p on p.id = c.patient_id
  where c.practitioner_id = p_practitioner and c.google_event_id is null and c.scheduled_at > now()
    and private.takes_time(c) and (c.fee_cents is null or c.paid_at is not null);
$$;

create or replace function private.whatsapp_view(p_consultation_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('consultation_id', c.id, 'scheduled_at', c.scheduled_at,
    'language', c.language, 'invite_token', c.invite_token, 'short_code', c.short_code,
    'must_pay', c.fee_cents is not null and c.paid_at is null,
    'patient_name', c.patient_claim_name)
  from public.consultations c where c.id = p_consultation_id;
$$;

create or replace function public.whatsapp_due_reminders() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('ok', true, 'reminders', coalesce(jsonb_agg(
      private.whatsapp_view(c.id) || jsonb_build_object('phone', coalesce(w.phone, c.patient_claim_phone))
      order by c.scheduled_at), '[]'::jsonb))
  from public.consultations c
    left join lateral (select x.phone from public.whatsapp_contacts x
                       where x.consultation_id = c.id limit 1) w on true
  where c.scheduled_at > now() and c.scheduled_at <= now() + interval '65 minutes'
    and c.reminder_sent_at is null and c.status in ('consent_pending', 'ready_for_audio')
    and private.takes_time(c) and (c.fee_cents is null or c.paid_at is not null)
    and (w.phone is not null or (c.remind_whatsapp and c.patient_claim_phone is not null));
$$;

-- A WhatsApp code routes messages to one consultation. It may record a claim,
-- but it never updates or establishes a canonical patient association.
create or replace function public.whatsapp_receive(
  p_wa_message_id text, p_phone text, p_profile_name text, p_kind text, p_body text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_phone text := private.normal_phone(p_phone);
  v_profile text := nullif(left(btrim(coalesce(p_profile_name, '')), 120), '');
  v_kind text := case when p_kind in ('text', 'image', 'document', 'audio') then p_kind else 'other' end;
  v_code text := upper(substring(coalesce(p_body, '') from '(?i)\m([0-9a-f]{8})\M'));
  v_consultation public.consultations;
  v_contact public.whatsapp_contacts;
  v_inserted uuid;
begin
  if v_phone is null or p_wa_message_id is null then return private.refuse('VALIDATION', 'message'); end if;
  insert into public.whatsapp_messages (wa_message_id, direction, phone, kind, body, status)
  values (p_wa_message_id, 'in', v_phone, v_kind, left(p_body, 4096), 'received')
  on conflict (wa_message_id) do nothing returning id into v_inserted;
  if v_inserted is null then return jsonb_build_object('ok', true, 'duplicate', true); end if;

  if v_kind = 'text' and v_code is not null then
    select * into v_consultation from public.consultations
    where whatsapp_code = v_code and status <> 'consent_withdrawn' for update;
  end if;
  if v_consultation.id is not null then
    insert into public.whatsapp_contacts (phone, consultation_id, profile_name, last_inbound_at)
    values (v_phone, v_consultation.id, v_profile, now())
    on conflict (phone) do update set consultation_id = excluded.consultation_id,
      profile_name = coalesce(excluded.profile_name, public.whatsapp_contacts.profile_name),
      linked_at = now(), last_inbound_at = now();
    if v_consultation.patient_association_state not in ('verified', 'practitioner_confirmed') then
      perform private.identify_patient(v_consultation, coalesce(v_profile, 'WhatsApp patient'), v_phone);
    end if;
    update public.whatsapp_messages set consultation_id = v_consultation.id where id = v_inserted;
    perform private.log_event(v_consultation.id, 'whatsapp.linked', 'patient', 'patient',
      'consultation', v_consultation.id, 'success');
    return jsonb_build_object('ok', true, 'linked', true,
      'consultation', private.whatsapp_view(v_consultation.id));
  end if;

  update public.whatsapp_contacts set last_inbound_at = now() where phone = v_phone returning * into v_contact;
  if v_contact.phone is null then
    return jsonb_build_object('ok', true, 'linked', false, 'consultation', null);
  end if;
  update public.whatsapp_messages set consultation_id = v_contact.consultation_id where id = v_inserted;
  return jsonb_build_object('ok', true, 'linked', false,
    'consultation', private.whatsapp_view(v_contact.consultation_id));
end;
$$;

-- The assigned engine may use this consultation's submitted name as a speech
-- hint. Cross-consultation spellings still require a verified patient_id.
create or replace function public.engine_hints(p_consultation_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_engine uuid := (select auth.uid());
begin
  if not private.is_engine() then return private.refuse('NOT_AN_ENGINE'); end if;
  if not exists (select 1 from public.live_pieces
                 where consultation_id = p_consultation_id and engine_user_id = v_engine)
     and not exists (select 1 from public.transcription_jobs
                     where consultation_id = p_consultation_id
                       and engine_user_id = v_engine and status = 'processing') then
    return private.refuse('NOT_FOUND');
  end if;
  return jsonb_build_object('ok', true, 'hints', coalesce((
    select jsonb_agg(distinct hint) from (
      select c.patient_claim_name as hint from public.consultations c
      where c.id = p_consultation_id
      union all
      select pp.display_name from public.consultations c
      join public.practitioner_profiles pp on pp.practitioner_id = c.practitioner_id
      where c.id = p_consultation_id
      union all
      select s.written from public.spellings s
      join public.consultations c on c.id = p_consultation_id
      where s.practitioner_id = c.practitioner_id
        and (s.consultation_id = c.id or (c.patient_id is not null and s.patient_id = c.patient_id))
    ) hints where hint is not null), '[]'::jsonb));
end;
$$;
