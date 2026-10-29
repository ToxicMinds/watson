-- Sign-in codes by WhatsApp (owner, 28 Oct 2026). Supabase Auth keeps a phone number without its "+"
-- (421905111222), while Watson writes it with one (+421905111222), so a session admitted by a WhatsApp
-- code was refused as CONTACT_UNVERIFIED. The same function, reading the number either way.
create or replace function public.register_patient_otp_session(
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
        or (v_phone is not null and '+' || ltrim(u.phone, '+') = v_phone and u.phone_confirmed_at is not null))
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
