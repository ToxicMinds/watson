-- A verified Auth user may self-provision only the least-privileged patient role.
-- Practitioner and engine roles remain admin-provisioned and mutually exclusive.
create function public.bootstrap_patient_role() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_verified boolean;
  v_roles text[];
begin
  if v_user_id is null then
    return private.refuse('NOT_SIGNED_IN');
  end if;

  -- Serialize provisioning against trusted role grants and engine registration.
  select u.email_confirmed_at is not null or u.phone_confirmed_at is not null
    into v_verified
  from auth.users u where u.id = v_user_id for update;

  if not coalesce(v_verified, false) then
    return private.refuse('CONTACT_UNVERIFIED');
  end if;

  select coalesce(array_agg(r.role order by r.role), '{}'::text[])
    into v_roles
  from private.user_roles r where r.user_id = v_user_id;

  if v_roles = array['patient']::text[] then
    return jsonb_build_object('ok', true, 'roles', v_roles);
  end if;
  if cardinality(v_roles) > 0 then
    return private.refuse('ROLE_ALREADY_ASSIGNED');
  end if;

  insert into private.user_roles (user_id, role) values (v_user_id, 'patient');
  return jsonb_build_object('ok', true, 'roles', array['patient']::text[]);
end;
$$;
revoke all on function public.bootstrap_patient_role() from public, anon, service_role;
grant execute on function public.bootstrap_patient_role() to authenticated;
