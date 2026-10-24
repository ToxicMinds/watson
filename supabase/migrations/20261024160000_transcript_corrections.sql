-- Correcting the transcript (owner, 24 October 2026: "this transcription should be editable … the
-- doctor having the ability to correct anything that he sees real time"). A practitioner corrects a
-- line of the live transcript during the call, or of the full transcript after it. Watson keeps what
-- it heard next to the correction, and learns the spelling ("Yana Novakova" is "Jana Nováková") for
-- this patient: lines written later, the full transcript and the patient's next consultations are
-- spelled that way, and the engine is told the names and spellings to listen for.

alter table public.live_pieces
  add column heard_text text check (char_length(heard_text) <= 4000), -- what the engine wrote, once corrected
  add column corrected_at timestamptz;

-- What a practitioner taught Watson, for one patient (or, without one, for one consultation).
create table public.spellings (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references auth.users (id) on delete cascade,
  patient_id uuid references public.patients (id) on delete cascade,
  consultation_id uuid not null references public.consultations (id) on delete cascade, -- where it was learned
  heard text not null check (char_length(heard) between 1 and 80),
  written text not null check (char_length(written) between 1 and 80),
  created_at timestamptz not null default now()
);
create unique index spellings_once on public.spellings (practitioner_id, (coalesce(patient_id, consultation_id)), (lower(heard)));
alter table public.spellings enable row level security;
revoke all on public.spellings from anon, authenticated, service_role;
grant select on public.spellings to authenticated;
create policy "Practitioners read the spellings they taught"
  on public.spellings for select to authenticated using (practitioner_id = (select auth.uid()));

-- The text, spelled as the practitioner taught for this consultation's patient. Longest first, so
-- "Yana Novakova" is replaced before a lone "Yana". Whole words only, any letter case.
create function private.apply_spellings(p_consultation_id uuid, p_text text) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_text text := p_text;
  v_spelling record;
begin
  if p_text is null then
    return null;
  end if;
  for v_spelling in
    select s.heard, s.written from public.spellings s
      join public.consultations c on c.id = p_consultation_id
    where s.practitioner_id = c.practitioner_id
      and (s.consultation_id = c.id or (c.patient_id is not null and s.patient_id = c.patient_id))
    order by char_length(s.heard) desc
  loop
    v_text := regexp_replace(v_text,
      '\m' || regexp_replace(v_spelling.heard, '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '\M',
      replace(v_spelling.written, '\', '\\'), 'gi');
  end loop;
  return v_text;
end;
$$;

-- Learns the pairs a correction taught: at most ten, each a few words that begin and end with a
-- letter or digit. False, and nothing learned, when any pair is not like that.
create function private.learn_spellings(p_consultation public.consultations, p_spellings jsonb) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_pair jsonb;
begin
  if jsonb_typeof(p_spellings) <> 'array' or jsonb_array_length(p_spellings) > 10 then
    return false;
  end if;
  for v_pair in select * from jsonb_array_elements(p_spellings) loop
    if jsonb_typeof(v_pair -> 'heard') <> 'string' or jsonb_typeof(v_pair -> 'written') <> 'string'
       or btrim(v_pair ->> 'heard') !~ '^\w(.{0,78}\w)?$' or btrim(v_pair ->> 'written') !~ '^\w(.{0,78}\w)?$'
       or position('\' in v_pair ->> 'written') > 0 or btrim(v_pair ->> 'heard') = btrim(v_pair ->> 'written') then
      return false;
    end if;
  end loop;
  insert into public.spellings (practitioner_id, patient_id, consultation_id, heard, written)
    select p_consultation.practitioner_id, p_consultation.patient_id, p_consultation.id,
           btrim(pair ->> 'heard'), btrim(pair ->> 'written')
    from jsonb_array_elements(p_spellings) pair
  on conflict (practitioner_id, (coalesce(patient_id, consultation_id)), (lower(heard)))
    do update set written = excluded.written, consultation_id = excluded.consultation_id, created_at = now();
  return true;
end;
$$;

-- A live line the engine has just written is spelled as taught; what it heard is kept.
create function private.spell_live_piece() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_spelled text := private.apply_spellings(new.consultation_id, new.text);
begin
  if v_spelled is distinct from new.text then
    new.heard_text := new.text;
    new.text := v_spelled;
  end if;
  return new;
end;
$$;
create trigger spell_live_piece before update on public.live_pieces
  for each row when (old.status = 'reading' and new.status = 'done') execute function private.spell_live_piece();

-- So is each line of a full transcript as it is saved, in the corrected text beside what was heard.
create function private.spell_transcript_segment() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_spelled text := private.apply_spellings(
    (select t.consultation_id from public.transcripts t where t.id = new.transcript_id), new.machine_text);
begin
  if new.reviewed_text is null and v_spelled is distinct from new.machine_text then
    new.reviewed_text := v_spelled;
  end if;
  return new;
end;
$$;
create trigger spell_transcript_segment before insert on public.transcript_segments
  for each row execute function private.spell_transcript_segment();

-- The practitioner corrects a line of the live transcript, during the call.
create function public.correct_live_line(p_piece_id uuid, p_text text, p_spellings jsonb default '[]')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_piece public.live_pieces;
  v_consultation public.consultations;
  v_text text := btrim(coalesce(p_text, ''));
begin
  select p.* into v_piece from public.live_pieces p
    join public.consultations c on c.id = p.consultation_id
    where p.id = p_piece_id and c.practitioner_id = (select auth.uid())
    for update of p;
  if not found or v_piece.status <> 'done' then
    return private.refuse('NOT_FOUND');
  end if;
  if char_length(v_text) not between 1 and 4000 then
    return private.refuse('VALIDATION', 'text');
  end if;
  select * into v_consultation from public.consultations where id = v_piece.consultation_id;
  if not private.learn_spellings(v_consultation, coalesce(p_spellings, '[]'::jsonb)) then
    return private.refuse('VALIDATION', 'spellings');
  end if;
  update public.live_pieces set heard_text = coalesce(heard_text, text), text = v_text, corrected_at = now()
    where id = p_piece_id;
  -- The lines already on the screen are spelled the new way too.
  update public.live_pieces p
    set heard_text = coalesce(p.heard_text, p.text), text = private.apply_spellings(p.consultation_id, p.text)
    where p.consultation_id = v_piece.consultation_id and p.id <> p_piece_id and p.status = 'done'
      and private.apply_spellings(p.consultation_id, p.text) is distinct from p.text;
  perform private.log_event(v_piece.consultation_id, 'live_transcript.corrected', (select auth.uid())::text,
    'practitioner', 'live_piece', p_piece_id, 'success');
  return jsonb_build_object('ok', true);
end;
$$;

-- The practitioner corrects a line of the full transcript, until the form is approved.
create function public.correct_transcript_line(p_segment_id uuid, p_text text, p_spellings jsonb default '[]')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_segment public.transcript_segments;
  v_consultation public.consultations;
  v_text text := btrim(coalesce(p_text, ''));
begin
  select s.* into v_segment from public.transcript_segments s
    join public.transcripts t on t.id = s.transcript_id
    join public.consultations c on c.id = t.consultation_id
    where s.id = p_segment_id and c.practitioner_id = (select auth.uid()) and t.review_status <> 'superseded'
    for update of s;
  if not found then
    return private.refuse('NOT_FOUND');
  end if;
  select c.* into v_consultation from public.consultations c
    join public.transcripts t on t.consultation_id = c.id where t.id = v_segment.transcript_id
    for update of c;
  if v_consultation.status in ('approved', 'corrected', 'archived', 'consent_withdrawn') then
    return private.refuse('INVALID_STATE_TRANSITION');
  end if;
  if char_length(v_text) not between 1 and 4000 then
    return private.refuse('VALIDATION', 'text');
  end if;
  if not private.learn_spellings(v_consultation, coalesce(p_spellings, '[]'::jsonb)) then
    return private.refuse('VALIDATION', 'spellings');
  end if;
  update public.transcript_segments
    set reviewed_text = case when v_text = machine_text then null else v_text end
    where id = p_segment_id;
  -- The rest of the transcript is spelled the new way too.
  update public.transcript_segments s
    set reviewed_text = private.apply_spellings(v_consultation.id, coalesce(s.reviewed_text, s.machine_text))
    where s.transcript_id = v_segment.transcript_id and s.id <> p_segment_id
      and private.apply_spellings(v_consultation.id, coalesce(s.reviewed_text, s.machine_text))
          is distinct from coalesce(s.reviewed_text, s.machine_text);
  perform private.log_event(v_consultation.id, 'transcript.corrected', (select auth.uid())::text,
    'practitioner', 'transcript_segment', p_segment_id, 'success');
  return jsonb_build_object('ok', true);
end;
$$;

-- For the engine, about a consultation whose audio it is reading: the names and spellings to listen
-- for (the patient, the practitioner, what the practitioner taught).
create function public.engine_hints(p_consultation_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_engine uuid := (select auth.uid());
begin
  if not private.is_engine() then
    return private.refuse('NOT_AN_ENGINE');
  end if;
  if not exists (select 1 from public.live_pieces where consultation_id = p_consultation_id and engine_user_id = v_engine)
     and not exists (select 1 from public.transcription_jobs where consultation_id = p_consultation_id
                     and engine_user_id = v_engine and status = 'processing') then
    return private.refuse('NOT_FOUND');
  end if;
  return jsonb_build_object('ok', true, 'hints', coalesce((
    select jsonb_agg(distinct hint) from (
      select p.name as hint from public.consultations c join public.patients p on p.id = c.patient_id
        where c.id = p_consultation_id
      union all
      select pp.display_name from public.consultations c join public.practitioner_profiles pp on pp.practitioner_id = c.practitioner_id
        where c.id = p_consultation_id
      union all
      select s.written from public.spellings s join public.consultations c on c.id = p_consultation_id
        where s.practitioner_id = c.practitioner_id
          and (s.consultation_id = c.id or (c.patient_id is not null and s.patient_id = c.patient_id))
    ) hints where hint is not null), '[]'::jsonb));
end;
$$;

-- The live piece the engine claims now says which consultation it belongs to (for its hints).
-- Otherwise as in 20261024130000_live_pieces_cleanup.
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
    'id', v_piece.id, 'consultation_id', v_piece.consultation_id, 'storage_path', v_piece.storage_path,
    'speaker', v_piece.speaker,
    'language', (select nullif(c.language::text, 'auto') from public.consultations c where c.id = v_piece.consultation_id)));
end;
$$;

revoke all on function private.apply_spellings(uuid, text), private.learn_spellings(public.consultations, jsonb),
  private.spell_live_piece(), private.spell_transcript_segment()
from public, anon, authenticated, service_role;
revoke all on function public.correct_live_line(uuid, text, jsonb), public.correct_transcript_line(uuid, text, jsonb),
  public.engine_hints(uuid)
from public, anon, service_role;
grant execute on function public.correct_live_line(uuid, text, jsonb), public.correct_transcript_line(uuid, text, jsonb),
  public.engine_hints(uuid)
to authenticated;
