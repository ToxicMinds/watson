-- Since SEC-02 a new account is nobody until it is given a role. Watson's own scripts, holding the
-- service key, make practitioners (scripts/local-accounts.mjs on one computer, sample-practitioners.mjs,
-- a new doctor on the hosted Watson), as register_engine makes engines. Never for an engine account.
create function public.register_practitioner(p_user_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assign_role(p_user_id, 'practitioner');
end;
$$;
revoke all on function public.register_practitioner(uuid) from public, anon, authenticated;
grant execute on function public.register_practitioner(uuid) to service_role;
