-- Watson's engine moved to Watson's own Modal workspace (owner, 24 October 2026: every service
-- under Watson's own accounts). The owner's notice names that workspace now; otherwise unchanged.
create or replace function private.wake_engine() returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_url text := (select decrypted_secret from vault.decrypted_secrets where name = 'engine_wake_url');
  v_secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'engine_wake_secret');
  v_decision text := private.engine_wake_decision();
begin
  if v_decision = 'allowance used' then
    perform private.notify_owner('engine-allowance-' || to_char(now(), 'YYYY-MM'),
      'Watson''s engine is paused for the rest of the month',
      'Watson has used this month''s allowance of engine time, so transcripts, documents and forms '
      || 'now wait until the 1st. Nothing is lost: they are done as soon as the engine may run again.'
      || E'\n\n' || 'To carry on now: add a card on Modal (modal.com, workspace watson-assists, signed in '
      || 'with Watson''s GitHub), which raises its free credit from $1 to $30 a month, and ask Claude '
      || 'to raise the allowance.');
    return;
  end if;
  if v_url is null or v_secret is null or v_decision <> 'wake' then
    return;
  end if;
  perform net.http_post(url := v_url, body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret));
end;
$$;
