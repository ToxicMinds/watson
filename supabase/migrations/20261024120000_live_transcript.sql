-- The live transcript during the call (owner, 24 October 2026: "when we are talking on the screen, I
-- would like to see the transcript side-by-side live, like it happens in Teams"; always on). While the
-- call is recorded, the doctor's browser also sends each voice in ten-second pieces. The cloud engine
-- reads them before any other work, writes the text here for the call screen, and removes each piece.
-- The transcript after the call is still made from the complete recordings.

create table public.live_pieces (
  id uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references public.consultations (id) on delete cascade,
  speaker public.speaker not null,
  seq int not null check (seq between 0 and 100000),
  offset_seconds numeric(8, 2) not null check (offset_seconds >= 0), -- from the start of the recording
  storage_path text not null,
  status text not null default 'waiting' check (status in ('waiting', 'reading', 'done', 'failed')),
  text text check (char_length(text) <= 4000),
  engine_user_id uuid references public.engines (user_id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (consultation_id, speaker, seq)
);
create index live_pieces_waiting on public.live_pieces (created_at) where status = 'waiting';
alter table public.live_pieces enable row level security;
revoke all on public.live_pieces from anon, authenticated, service_role;
grant select on public.live_pieces to authenticated, service_role;
create policy "Practitioners read the live transcript of their consultations"
  on public.live_pieces for select to authenticated
  using (exists (select 1 from public.consultations c
                 where c.id = live_pieces.consultation_id and c.practitioner_id = (select auth.uid())));

-- Who may touch a piece's file: the doctor adds it during a consented call; the engine that claimed
-- it reads and removes it. Nobody else, and the full recordings keep their own rules.
create function private.live_piece_access(p_object_name text, p_action text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case p_action
    when 'add' then exists (
      select 1 from public.consultations c
      where c.practitioner_id = (select auth.uid())
        and c.status = 'ready_for_audio' and c.consent_recorded_at is not null
        and p_object_name ~ ('^' || c.practitioner_id::text || '/' || c.id::text || '/live/(practitioner|patient)-[0-9]{1,6}$'))
    when 'engine' then exists (
      select 1 from public.live_pieces p
      where p.storage_path = p_object_name and p.engine_user_id = (select auth.uid()))
    else false
  end;
$$;
revoke all on function private.live_piece_access(text, text) from public, anon, authenticated, service_role;
grant execute on function private.live_piece_access(text, text) to authenticated;

create policy "Practitioners add live pieces during a consented call"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'audio' and private.live_piece_access(name, 'add'));
create policy "The engine reads the live piece it claimed"
  on storage.objects for select to authenticated
  using (bucket_id = 'audio' and private.live_piece_access(name, 'engine'));
create policy "The engine removes the live piece it read"
  on storage.objects for delete to authenticated
  using (bucket_id = 'audio' and private.live_piece_access(name, 'engine'));

-- The doctor's browser, after uploading a piece: it waits for the engine. Sent twice, kept once.
create function public.add_live_piece(
  p_consultation_id uuid, p_speaker public.speaker, p_seq int, p_offset_seconds numeric
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_consultation public.consultations;
begin
  select * into v_consultation from public.consultations
    where id = p_consultation_id and practitioner_id = (select auth.uid());
  if not found then
    return private.refuse('NOT_FOUND');
  end if;
  if v_consultation.consent_recorded_at is null or v_consultation.status <> 'ready_for_audio' then
    return private.refuse('CONSENT_MISSING');
  end if;
  if p_speaker is null or p_seq is null or p_seq not between 0 and 100000 or p_offset_seconds is null or p_offset_seconds < 0 then
    return private.refuse('VALIDATION', 'piece');
  end if;
  insert into public.live_pieces (consultation_id, speaker, seq, offset_seconds, storage_path)
    values (p_consultation_id, p_speaker, p_seq, round(p_offset_seconds, 2),
            v_consultation.practitioner_id::text || '/' || p_consultation_id::text || '/live/' || p_speaker::text || '-' || p_seq)
    on conflict (consultation_id, speaker, seq) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

-- The engine: the oldest piece waiting, or one whose engine went quiet. A piece of a call that has
-- ended (the full transcript is on its way), or from more than ten minutes ago, is set aside unread.
create function public.engine_claim_live_piece() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_engine uuid := (select auth.uid());
  v_piece public.live_pieces;
begin
  if not private.is_engine() then
    return private.refuse('NOT_AN_ENGINE');
  end if;
  update public.engines set last_seen_at = now() where user_id = v_engine;
  update public.live_pieces p set status = 'failed'
    where p.status in ('waiting', 'reading')
      and (p.created_at < now() - interval '10 minutes'
           or not exists (select 1 from public.consultations c where c.id = p.consultation_id and c.status = 'ready_for_audio'));
  select * into v_piece from public.live_pieces p
    where p.status = 'waiting' or (p.status = 'reading' and p.claimed_at < now() - interval '1 minute')
    order by p.created_at limit 1
    for update skip locked;
  if not found then
    return jsonb_build_object('ok', true, 'piece', null);
  end if;
  update public.live_pieces set status = 'reading', claimed_at = now(), engine_user_id = v_engine
    where id = v_piece.id;
  return jsonb_build_object('ok', true, 'piece', jsonb_build_object(
    'id', v_piece.id, 'storage_path', v_piece.storage_path, 'speaker', v_piece.speaker,
    'language', (select nullif(c.language::text, 'auto') from public.consultations c where c.id = v_piece.consultation_id)));
end;
$$;

create function public.engine_live_piece_done(p_id uuid, p_text text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_engine() then
    return private.refuse('NOT_AN_ENGINE');
  end if;
  update public.live_pieces set status = 'done', text = left(btrim(coalesce(p_text, '')), 4000)
    where id = p_id and engine_user_id = (select auth.uid()) and status = 'reading';
  if not found then
    return private.refuse('NOT_FOUND');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.engine_live_piece_failed(p_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_engine() then
    return private.refuse('NOT_AN_ENGINE');
  end if;
  update public.live_pieces set status = 'failed'
    where id = p_id and engine_user_id = (select auth.uid()) and status = 'reading';
  return jsonb_build_object('ok', true);
end;
$$;

-- Live pieces are work too: they wake the cloud engine, and keep it from stopping.
create or replace function private.engine_work_waiting() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.live_pieces p join public.consultations c on c.id = p.consultation_id
                 where p.status = 'waiting' and p.created_at > now() - interval '10 minutes' and c.status = 'ready_for_audio')
      or exists (select 1 from public.transcription_jobs j
                 where j.status = 'queued' or (j.status = 'processing' and j.heartbeat_at < now() - interval '2 minutes'))
      or exists (select 1 from public.form_jobs j
                 where j.status = 'queued' or (j.status = 'processing' and j.heartbeat_at < now() - interval '2 minutes'))
      or exists (select 1 from public.patient_documents d
                 where (d.reading = 'waiting' and d.uploaded_at is not null)
                    or (d.reading = 'reading' and d.claimed_at < now() - interval '10 minutes'));
$$;

create trigger wake_engine after insert on public.live_pieces
  for each row when (new.status = 'waiting') execute function private.wake_engine_on_work();

revoke all on function
  public.add_live_piece(uuid, public.speaker, int, numeric), public.engine_claim_live_piece(),
  public.engine_live_piece_done(uuid, text), public.engine_live_piece_failed(uuid)
from public, anon, service_role;
grant execute on function
  public.add_live_piece(uuid, public.speaker, int, numeric), public.engine_claim_live_piece(),
  public.engine_live_piece_done(uuid, text), public.engine_live_piece_failed(uuid)
to authenticated;
