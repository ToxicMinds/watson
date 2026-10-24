-- A live piece set aside unread (its call ended, or it is over ten minutes old) still had its file in
-- storage: the first live rehearsal left three. The engine now takes charge of the pieces it sets
-- aside and is handed their files to remove, as it removes the files of the pieces it reads.
create or replace function public.engine_claim_live_piece() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_engine uuid := (select auth.uid());
  v_piece public.live_pieces;
  v_remove jsonb;
begin
  if not private.is_engine() then
    return private.refuse('NOT_AN_ENGINE');
  end if;
  update public.engines set last_seen_at = now() where user_id = v_engine;
  with set_aside as (
    update public.live_pieces p set status = 'failed', engine_user_id = v_engine
      where p.status in ('waiting', 'reading')
        and (p.created_at < now() - interval '10 minutes'
             or not exists (select 1 from public.consultations c where c.id = p.consultation_id and c.status = 'ready_for_audio'))
      returning p.storage_path)
  select coalesce(jsonb_agg(storage_path), '[]'::jsonb) into v_remove from set_aside;
  select * into v_piece from public.live_pieces p
    where p.status = 'waiting' or (p.status = 'reading' and p.claimed_at < now() - interval '1 minute')
    order by p.created_at limit 1
    for update skip locked;
  if not found then
    return jsonb_build_object('ok', true, 'piece', null, 'remove', v_remove);
  end if;
  update public.live_pieces set status = 'reading', claimed_at = now(), engine_user_id = v_engine
    where id = v_piece.id;
  return jsonb_build_object('ok', true, 'remove', v_remove, 'piece', jsonb_build_object(
    'id', v_piece.id, 'storage_path', v_piece.storage_path, 'speaker', v_piece.speaker,
    'language', (select nullif(c.language::text, 'auto') from public.consultations c where c.id = v_piece.consultation_id)));
end;
$$;
