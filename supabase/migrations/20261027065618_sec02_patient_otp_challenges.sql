-- Native Auth OTP verification is public and only rate-limited by IP. Keep a
-- server-only challenge ledger so brute-force attempts are capped per contact.
create table private.patient_otp_challenges (
  contact_hash text primary key check (contact_hash ~ '^[0-9a-f]{64}$'),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  sent_at timestamptz not null,
  expires_at timestamptz not null,
  send_window_started_at timestamptz not null,
  send_count integer not null default 0 check (send_count >= 0),
  attempts_window_started_at timestamptz not null,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.patient_otp_ip_limits (
  ip_hash text primary key check (ip_hash ~ '^[0-9a-f]{64}$'),
  send_window_started_at timestamptz not null,
  send_count integer not null default 0 check (send_count >= 0),
  verify_window_started_at timestamptz not null,
  verify_count integer not null default 0 check (verify_count >= 0),
  updated_at timestamptz not null default now()
);

revoke all on private.patient_otp_challenges, private.patient_otp_ip_limits from public, anon, authenticated, service_role;

-- Compare the fixed-size, keyed hashes without an early exit.
create function private.sec02_otp_hash_equal(p_left text, p_right text) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  v_difference integer := length(coalesce(p_left, '')) # length(coalesce(p_right, ''));
  v_length integer := greatest(length(coalesce(p_left, '')), length(coalesce(p_right, '')));
  v_left integer;
  v_right integer;
begin
  for i in 1..v_length loop
    v_left := coalesce(ascii(substring(p_left from i for 1)), 0);
    v_right := coalesce(ascii(substring(p_right from i for 1)), 0);
    v_difference := v_difference | (v_left # v_right);
  end loop;
  return v_difference = 0;
end;
$$;
revoke all on function private.sec02_otp_hash_equal(text, text) from public, anon, authenticated, service_role;

-- HMACs only: neither the email/phone nor the OTP is stored here. The edge
-- function owns the HMAC key and supplies domain-separated hashes.
create function public.issue_patient_otp_challenge(
  p_contact_hash text, p_code_hash text, p_ip_hash text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_ip_sends integer;
  v_challenge private.patient_otp_challenges;
  v_send_count integer;
  v_failed_attempts integer;
  v_attempts_window timestamptz;
begin
  if coalesce(p_contact_hash, '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_code_hash, '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_ip_hash, '') !~ '^[0-9a-f]{64}$' then
    return private.refuse('VALIDATION');
  end if;

  insert into private.patient_otp_ip_limits (
    ip_hash, send_window_started_at, send_count, verify_window_started_at, verify_count
  ) values (p_ip_hash, v_now, 1, v_now, 0)
  on conflict (ip_hash) do update set
    send_count = case
      when private.patient_otp_ip_limits.send_window_started_at <= v_now - interval '1 hour' then 1
      else private.patient_otp_ip_limits.send_count + 1
    end,
    send_window_started_at = case
      when private.patient_otp_ip_limits.send_window_started_at <= v_now - interval '1 hour' then v_now
      else private.patient_otp_ip_limits.send_window_started_at
    end,
    updated_at = v_now
  returning send_count into v_ip_sends;
  if v_ip_sends > 20 then return private.refuse('RATE_LIMITED'); end if;

  insert into private.patient_otp_challenges (
    contact_hash, code_hash, sent_at, expires_at, send_window_started_at,
    send_count, attempts_window_started_at, failed_attempts
  ) values (p_contact_hash, p_code_hash, '-infinity', '-infinity', v_now, 0, v_now, 0)
  on conflict (contact_hash) do nothing;

  select c.* into v_challenge
  from private.patient_otp_challenges c
  where c.contact_hash = p_contact_hash
  for update;

  if v_challenge.locked_until is not null and v_challenge.locked_until > v_now then
    return private.refuse('LOCKED');
  end if;
  if v_challenge.sent_at > v_now - interval '60 seconds' then
    return private.refuse('RATE_LIMITED');
  end if;
  if v_challenge.send_window_started_at > v_now - interval '1 hour' and v_challenge.send_count >= 2 then
    return private.refuse('RATE_LIMITED');
  end if;

  v_send_count := case
    when v_challenge.send_window_started_at <= v_now - interval '1 hour' then 1
    else v_challenge.send_count + 1
  end;
  v_attempts_window := case
    when v_challenge.attempts_window_started_at <= v_now - interval '1 hour' then v_now
    else v_challenge.attempts_window_started_at
  end;
  v_failed_attempts := case
    when v_attempts_window = v_now then 0
    else v_challenge.failed_attempts
  end;

  update private.patient_otp_challenges set
    code_hash = p_code_hash,
    sent_at = v_now,
    expires_at = v_now + interval '10 minutes',
    send_window_started_at = case
      when v_challenge.send_window_started_at <= v_now - interval '1 hour' then v_now
      else v_challenge.send_window_started_at
    end,
    send_count = v_send_count,
    attempts_window_started_at = v_attempts_window,
    failed_attempts = v_failed_attempts,
    locked_until = null,
    used_at = null,
    updated_at = v_now
  where contact_hash = p_contact_hash;

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.issue_patient_otp_challenge(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.issue_patient_otp_challenge(text, text, text) to service_role;

create function public.verify_patient_otp_challenge(
  p_contact_hash text, p_code_hash text, p_ip_hash text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_ip_verifies integer;
  v_challenge private.patient_otp_challenges;
  v_failed_attempts integer;
  v_attempts_window timestamptz;
begin
  if coalesce(p_contact_hash, '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_code_hash, '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_ip_hash, '') !~ '^[0-9a-f]{64}$' then
    return private.refuse('VALIDATION');
  end if;

  insert into private.patient_otp_ip_limits (
    ip_hash, send_window_started_at, send_count, verify_window_started_at, verify_count
  ) values (p_ip_hash, v_now, 0, v_now, 1)
  on conflict (ip_hash) do update set
    verify_count = case
      when private.patient_otp_ip_limits.verify_window_started_at <= v_now - interval '5 minutes' then 1
      else private.patient_otp_ip_limits.verify_count + 1
    end,
    verify_window_started_at = case
      when private.patient_otp_ip_limits.verify_window_started_at <= v_now - interval '5 minutes' then v_now
      else private.patient_otp_ip_limits.verify_window_started_at
    end,
    updated_at = v_now
  returning verify_count into v_ip_verifies;
  if v_ip_verifies > 30 then return private.refuse('RATE_LIMITED'); end if;

  select c.* into v_challenge
  from private.patient_otp_challenges c
  where c.contact_hash = p_contact_hash
  for update;
  if not found then return private.refuse('INVALID_CODE'); end if;
  if v_challenge.locked_until is not null and v_challenge.locked_until > v_now then
    return private.refuse('LOCKED');
  end if;
  if v_challenge.used_at is not null or v_challenge.expires_at <= v_now then
    return private.refuse('INVALID_CODE');
  end if;

  if private.sec02_otp_hash_equal(v_challenge.code_hash, p_code_hash) then
    update private.patient_otp_challenges set used_at = v_now, updated_at = v_now
    where contact_hash = p_contact_hash;
    return jsonb_build_object('ok', true);
  end if;

  v_attempts_window := case
    when v_challenge.attempts_window_started_at <= v_now - interval '1 hour' then v_now
    else v_challenge.attempts_window_started_at
  end;
  v_failed_attempts := case
    when v_attempts_window = v_now then 1
    else v_challenge.failed_attempts + 1
  end;
  update private.patient_otp_challenges set
    attempts_window_started_at = v_attempts_window,
    failed_attempts = v_failed_attempts,
    locked_until = case when v_failed_attempts >= 5 then v_now + interval '15 minutes' else null end,
    updated_at = v_now
  where contact_hash = p_contact_hash;
  if v_failed_attempts >= 5 then return private.refuse('LOCKED'); end if;
  return private.refuse('INVALID_CODE');
end;
$$;
revoke all on function public.verify_patient_otp_challenge(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.verify_patient_otp_challenge(text, text, text) to service_role;

create function public.cancel_patient_otp_challenge(p_contact_hash text, p_code_hash text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(p_contact_hash, '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_code_hash, '') !~ '^[0-9a-f]{64}$' then
    return private.refuse('VALIDATION');
  end if;
  update private.patient_otp_challenges set used_at = now(), updated_at = now()
  where contact_hash = p_contact_hash
    and private.sec02_otp_hash_equal(code_hash, p_code_hash)
    and used_at is null;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.cancel_patient_otp_challenge(text, text) from public, anon, authenticated, service_role;
grant execute on function public.cancel_patient_otp_challenge(text, text) to service_role;
