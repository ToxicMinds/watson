-- SEC-02 foundation: authorization roles are database-owned, never inferred from a
-- signed-in session or user-editable Auth metadata.
create table private.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('practitioner', 'patient', 'engine')),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);
revoke all on private.user_roles from public, anon, authenticated, service_role;

create function private.enforce_exclusive_engine_role() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from auth.users where id = new.user_id for update;
  if new.role = 'engine' and exists (
    select 1 from private.user_roles r where r.user_id = new.user_id and r.role <> 'engine'
  ) then
    raise exception 'Engine role cannot overlap another role';
  end if;
  if new.role <> 'engine' and exists (
    select 1 from private.user_roles r where r.user_id = new.user_id and r.role = 'engine'
  ) then
    raise exception 'Engine role cannot overlap another role';
  end if;
  return new;
end;
$$;

create trigger user_roles_engine_exclusive
  before insert or update on private.user_roles
  for each row execute function private.enforce_exclusive_engine_role();

create function private.require_practitioner_owner() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid := case when tg_op = 'DELETE' then old.practitioner_id else new.practitioner_id end;
begin
  if (select auth.uid()) is not null and not exists (
    select 1 from private.user_roles r where r.user_id = v_owner and r.role = 'practitioner'
  ) then
    raise exception using errcode = '42501', message = 'Practitioner role required';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger consultations_require_practitioner_owner
  before insert or update or delete on public.consultations
  for each row execute function private.require_practitioner_owner();
create trigger practitioner_profiles_require_practitioner_owner
  before insert or update or delete on public.practitioner_profiles
  for each row execute function private.require_practitioner_owner();
create trigger form_templates_require_practitioner_owner
  before insert or update or delete on public.form_templates
  for each row execute function private.require_practitioner_owner();
create trigger spellings_require_practitioner_owner
  before insert or update or delete on public.spellings
  for each row execute function private.require_practitioner_owner();

-- Existing accounts are classified only from authoritative records. Unclassified
-- accounts receive no practitioner role and therefore fail closed.
do $$
begin
  if exists (
    select 1
    from public.engines e
    join public.practitioner_profiles p on p.practitioner_id = e.user_id
  ) or exists (
    select 1
    from public.engines e
    join public.consultations c on c.practitioner_id = e.user_id
  ) then
    raise exception 'SEC-02 role backfill blocked: engine account has practitioner records';
  end if;
end;
$$;

insert into private.user_roles (user_id, role)
select e.user_id, 'engine' from public.engines e;

insert into private.user_roles (user_id, role)
select distinct p.practitioner_id, 'practitioner'
from public.practitioner_profiles p
union
select distinct c.practitioner_id, 'practitioner'
from public.consultations c
where not exists (select 1 from public.engines e where e.user_id = c.practitioner_id);

create function private.has_role(p_role text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from private.user_roles r
    where r.user_id = (select auth.uid()) and r.role = p_role
  );
$$;
revoke all on function private.has_role(text) from public, anon;
grant execute on function private.has_role(text) to authenticated, service_role;

create function private.is_practitioner() returns boolean
language sql stable security definer set search_path = ''
as $$ select private.has_role('practitioner'); $$;
revoke all on function private.is_practitioner() from public, anon;
grant execute on function private.is_practitioner() to authenticated, service_role;

create function private.assign_role(p_user_id uuid, p_role text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_role not in ('practitioner', 'patient') then
    raise exception 'Invalid role';
  end if;
  insert into private.user_roles (user_id, role) values (p_user_id, p_role)
  on conflict (user_id, role) do nothing;
end;
$$;
revoke all on function private.assign_role(uuid, text) from public, anon, authenticated;
grant execute on function private.assign_role(uuid, text) to service_role;

create function private.sync_engine_role() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into private.user_roles (user_id, role) values (new.user_id, 'engine');
    return new;
  end if;
  delete from private.user_roles where user_id = old.user_id and role = 'engine';
  return old;
end;
$$;
create trigger engines_sync_role
  after insert or delete on public.engines
  for each row execute function private.sync_engine_role();

drop policy "Practitioners read their own consultations" on public.consultations;
create policy "Practitioners read their own consultations"
  on public.consultations for select to authenticated
  using (private.is_practitioner() and practitioner_id = (select auth.uid()));

drop policy "Practitioners read their own booking page" on public.practitioner_profiles;
create policy "Practitioners read their own booking page"
  on public.practitioner_profiles for select to authenticated
  using (private.is_practitioner() and practitioner_id = (select auth.uid()));

drop policy "Practitioners read their own form template" on public.form_templates;
create policy "Practitioners read their own form template"
  on public.form_templates for select to authenticated
  using (private.is_practitioner() and practitioner_id = (select auth.uid()));

drop policy "Practitioners read their patients' documents" on public.patient_documents;
create policy "Practitioners read their patients' documents"
  on public.patient_documents for select to authenticated
  using (private.is_practitioner() and practitioner_id = (select auth.uid()));

drop policy "Practitioners read the spellings they taught" on public.spellings;
create policy "Practitioners read the spellings they taught"
  on public.spellings for select to authenticated
  using (private.is_practitioner() and practitioner_id = (select auth.uid()));

create or replace function private.document_access(p_object_name text, p_action text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case p_action
    when 'add' then exists (
      select 1 from public.patient_documents d
      where d.storage_path = p_object_name and d.removed_at is null
        and d.uploaded_at is null
        and d.created_at > now() - interval '30 minutes'
        and (d.source = 'patient'
             or (d.practitioner_id = (select auth.uid()) and private.is_practitioner())))
    when 'read' then exists (
      select 1 from public.patient_documents d
      where d.storage_path = p_object_name and d.removed_at is null
        and ((d.practitioner_id = (select auth.uid()) and private.is_practitioner())
             or (d.reading = 'reading' and d.engine_user_id = (select auth.uid())
                 and private.is_engine())))
       or not exists (select 1 from public.patient_documents d where d.storage_path = p_object_name)
    when 'remove' then false
    else false
  end;
$$;

create or replace function public.create_consultation(
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
  if not private.is_practitioner() or private.is_engine() then
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
  if (nullif(btrim(coalesce(p_patient_name, '')), '') is null)
    <> (nullif(btrim(coalesce(p_patient_contact, '')), '') is null) then
    return private.refuse('VALIDATION', 'patient');
  end if;

  begin
    insert into public.consultations (
      practitioner_id, synthetic_patient_ref, scheduled_at, language, status,
      consent_recorded_at, consent_recorded_by, scenario_notes, fee_cents
    ) values (
      v_user, coalesce(p_synthetic_patient_ref, private.new_reference()), p_scheduled_at,
      p_language, v_status, case when p_consent_recorded then now() end,
      case when p_consent_recorded then v_user end, coalesce(p_scenario_notes, ''), p_fee_cents
    ) returning * into v_consultation;
    if nullif(btrim(coalesce(p_patient_name, '')), '') is not null then
      v_patient := private.identify_patient(v_consultation, p_patient_name, p_patient_contact);
      if not (v_patient ->> 'ok')::boolean then
        raise exception using errcode = 'W0001';
      end if;
    end if;
  exception when sqlstate 'W0001' then
    return v_patient;
  end;

  perform private.log_event(v_consultation.id, 'consultation.created', v_user::text,
    'practitioner', 'consultation', v_consultation.id, 'success',
    jsonb_build_object('to_status', v_status));
  if p_consent_recorded then
    perform private.log_event(v_consultation.id, 'consent.recorded', v_user::text,
      'practitioner', 'consultation', v_consultation.id, 'success');
  end if;
  return jsonb_build_object('ok', true, 'consultation_id', v_consultation.id);
end;
$$;

create or replace function public.record_consent(p_consultation_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_consultation public.consultations;
begin
  if v_user is null then
    return private.refuse('NOT_SIGNED_IN');
  end if;
  if not private.is_practitioner() or private.is_engine() then
    return private.refuse('NOT_A_PRACTITIONER');
  end if;
  select * into v_consultation from public.consultations
    where id = p_consultation_id and practitioner_id = v_user for update;
  if not found then
    return private.refuse('NOT_FOUND');
  end if;
  if v_consultation.status <> 'consent_pending' then
    return private.reject_transition(p_consultation_id, 'record_consent', v_consultation.status);
  end if;

  update public.consultations
    set status = 'ready_for_audio', consent_recorded_at = now(), consent_recorded_by = v_user,
        updated_at = now()
    where id = p_consultation_id;
  perform private.log_event(p_consultation_id, 'consent.recorded', v_user::text,
    'practitioner', 'consultation', p_consultation_id, 'success',
    jsonb_build_object('from_status', 'consent_pending', 'to_status', 'ready_for_audio'));
  return jsonb_build_object('ok', true);
end;
$$;
