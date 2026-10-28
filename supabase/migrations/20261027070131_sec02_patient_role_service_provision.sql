-- Patient roles are granted only after the server-side OTP challenge succeeds.
-- Auth's public OTP endpoint cannot call this service-only provisioning function.
revoke all on function public.bootstrap_patient_role() from public, anon, authenticated, service_role;

create function public.provision_patient_role_after_otp(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_verified boolean;
  v_roles text[];
begin
  if p_user_id is null then return private.refuse('VALIDATION'); end if;

  select u.email_confirmed_at is not null or u.phone_confirmed_at is not null
    into v_verified
  from auth.users u where u.id = p_user_id for update;
  if not coalesce(v_verified, false) then return private.refuse('CONTACT_UNVERIFIED'); end if;

  select coalesce(array_agg(r.role order by r.role), '{}'::text[])
    into v_roles
  from private.user_roles r where r.user_id = p_user_id;
  if v_roles = array['patient']::text[] then
    return jsonb_build_object('ok', true, 'roles', v_roles);
  end if;
  if cardinality(v_roles) > 0 then return private.refuse('ROLE_ALREADY_ASSIGNED'); end if;

  insert into private.user_roles (user_id, role) values (p_user_id, 'patient');
  return jsonb_build_object('ok', true, 'roles', array['patient']::text[]);
end;
$$;
revoke all on function public.provision_patient_role_after_otp(uuid) from public, anon, authenticated;
grant execute on function public.provision_patient_role_after_otp(uuid) to service_role;

-- Auth's own email OTP endpoint remains public. A patient role is therefore
-- effective only for the specific Auth session minted by the server challenge.
create table private.patient_otp_sessions (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (session_id, user_id)
);
revoke all on private.patient_otp_sessions from public, anon, authenticated, service_role;

create function public.register_patient_otp_session(p_user_id uuid, p_session_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if p_user_id is null or p_session_id is null then return private.refuse('VALIDATION'); end if;
  if not exists (
    select 1 from private.user_roles r where r.user_id = p_user_id and r.role = 'patient'
  ) or not exists (
    select 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_user_id
  ) then return private.refuse('SESSION_INVALID'); end if;

  insert into private.patient_otp_sessions(session_id, user_id)
  values (p_session_id, p_user_id)
  on conflict (session_id) do update set user_id = excluded.user_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.register_patient_otp_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.register_patient_otp_session(uuid, uuid) to service_role;

create or replace function private.has_role(p_role text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from private.user_roles r
    where r.user_id = (select auth.uid())
      and r.role = p_role
      and (
        p_role <> 'patient'
        or exists (
          select 1 from private.patient_otp_sessions s
          where s.user_id = r.user_id
            and s.session_id = nullif(auth.jwt()->>'session_id', '')::uuid
        )
      )
  );
$$;
revoke all on function private.has_role(text) from public, anon;
grant execute on function private.has_role(text) to authenticated, service_role;

create or replace function public.current_user_roles() returns text[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(r.role order by r.role), '{}'::text[])
  from private.user_roles r
  where r.user_id = (select auth.uid())
    and (r.role <> 'patient' or private.has_role('patient'));
$$;
revoke all on function public.current_user_roles() from public, anon, service_role;
grant execute on function public.current_user_roles() to authenticated;
