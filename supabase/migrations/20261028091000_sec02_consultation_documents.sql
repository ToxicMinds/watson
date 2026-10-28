-- SEC-02 W4: documents belong to a consultation first. A patient association
-- may label that ownership later, but never changes which form job can read it.

alter table public.patient_documents
  alter column patient_id drop not null,
  add column legacy_patient_id uuid;

update public.patient_documents d
set legacy_patient_id = d.patient_id, patient_id = null
from public.consultations c
where c.id = d.consultation_id and c.patient_association_state = 'legacy_unverified';

create or replace function private.add_document(
  p_consultation public.consultations, p_file_name text, p_media_type text,
  p_size_bytes int, p_source text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_path text := p_consultation.practitioner_id::text || '/' || p_consultation.id::text || '/' || v_id::text;
  v_name text := btrim(regexp_replace(coalesce(p_file_name, ''), '[/\\[:cntrl:]]', '', 'g'));
begin
  if p_consultation.patient_claim_name is null and p_consultation.patient_id is null then
    return private.refuse('PATIENT_MISSING');
  end if;
  if char_length(v_name) not between 1 and 200 then return private.refuse('VALIDATION', 'file_name'); end if;
  if p_media_type is null or p_media_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') then
    return private.refuse('DOCUMENT_FORMAT_UNSUPPORTED');
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 then return private.refuse('VALIDATION', 'size_bytes'); end if;
  if p_size_bytes > 10485760 then return private.refuse('DOCUMENT_TOO_LARGE'); end if;
  if (select count(*) from public.patient_documents
      where consultation_id = p_consultation.id and removed_at is null) >= 20 then
    return private.refuse('DOCUMENT_LIMIT');
  end if;
  insert into public.patient_documents (
    id, practitioner_id, patient_id, consultation_id, storage_path,
    file_name, media_type, size_bytes, source
  ) values (
    v_id, p_consultation.practitioner_id, p_consultation.patient_id,
    p_consultation.id, v_path, v_name, p_media_type, p_size_bytes, p_source
  );
  return jsonb_build_object('ok', true, 'document_id', v_id, 'path', v_path);
end;
$$;
revoke all on function private.add_document(public.consultations, text, text, int, text)
from public, anon, authenticated, service_role;

-- Association changes label only this consultation's documents and emit one
-- non-clinical audit event per moved row. Rejection removes the patient label.
create function private.sync_consultation_document_association() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_document record;
  v_actor_role text := case when new.patient_association_state = 'verified' then 'patient' else 'practitioner' end;
  v_event_type text := case when new.patient_id is null then 'document.association_removed'
                            else 'document.association_confirmed' end;
begin
  if new.patient_id is not distinct from old.patient_id then return new; end if;
  for v_document in
    update public.patient_documents d set patient_id = new.patient_id
    where d.consultation_id = new.id and d.patient_id is distinct from new.patient_id
    returning d.id, d.source
  loop
    perform private.log_event(new.id, v_event_type, coalesce(new.patient_associated_by::text, 'system'),
      v_actor_role, 'patient_document', v_document.id, 'success',
      jsonb_build_object('source', v_document.source));
  end loop;
  return new;
end;
$$;
revoke all on function private.sync_consultation_document_association()
from public, anon, authenticated, service_role;
create trigger consultations_sync_document_association
after update of patient_id on public.consultations
for each row execute function private.sync_consultation_document_association();

-- A form job receives only documents uploaded to its consultation. A contact
-- collision or even a valid patient association cannot pull another visit in.
create or replace function public.engine_claim_form_job() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_engine uuid := (select auth.uid());
  v_job public.form_jobs;
  v_consultation public.consultations;
begin
  if not private.is_engine() then return private.refuse('NOT_AN_ENGINE'); end if;
  update public.engines set last_seen_at = now() where user_id = v_engine;
  for v_job in
    select j.* from public.form_jobs j join public.consultations c on c.id = j.consultation_id
    where j.status = 'processing' and j.heartbeat_at < now() - interval '2 minutes'
    for update of c, j skip locked
  loop
    if v_job.attempt >= 3 then
      perform private.fail_form_job(v_job, 'ENGINE_STALLED', v_engine::text);
    else
      update public.form_jobs set status = 'queued', attempt = attempt + 1,
        claimed_at = null, heartbeat_at = null, engine_user_id = null where id = v_job.id;
    end if;
  end loop;

  select j.* into v_job from public.form_jobs j
    join public.consultations c on c.id = j.consultation_id
    where j.status = 'queued' order by j.queued_at limit 1
    for update of c, j skip locked;
  if not found then return jsonb_build_object('ok', true, 'job', null); end if;
  select * into v_consultation from public.consultations where id = v_job.consultation_id;
  update public.form_jobs set status = 'processing', claimed_at = now(), heartbeat_at = now(),
    engine_user_id = v_engine where id = v_job.id returning * into v_job;
  perform private.log_event(v_job.consultation_id, 'form.started', v_engine::text, 'engine',
    'form_job', v_job.id, 'success', jsonb_build_object('job_id', v_job.id, 'attempt', v_job.attempt));
  return jsonb_build_object('ok', true, 'job', jsonb_build_object(
    'job_id', v_job.id, 'attempt', v_job.attempt, 'consultation_id', v_consultation.id,
    'language', coalesce(nullif(v_consultation.language::text, 'auto'),
      (select tr.tracks -> 0 ->> 'language' from public.transcripts tr where tr.id = v_job.transcript_id)),
    'template', (select definition from public.form_templates
                 where practitioner_id = v_consultation.practitioner_id),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
        'position', s.position, 'speaker', s.speaker,
        'text', coalesce(s.reviewed_text, s.machine_text)) order by s.position), '[]'::jsonb)
      from public.transcript_segments s
      where s.transcript_id = v_job.transcript_id and not s.possibly_not_speech),
    'documents', (select coalesce(jsonb_agg(jsonb_build_object(
        'document_id', d.id, 'file_name', d.file_name, 'sent_at', d.uploaded_at,
        'pages', to_jsonb(d.page_texts)) order by d.uploaded_at desc), '[]'::jsonb)
      from (select * from public.patient_documents
            where consultation_id = v_consultation.id and removed_at is null and reading = 'read'
            order by uploaded_at desc limit 10) d)));
end;
$$;

-- Latest historical definition includes fill-again preservation. Only the
-- document quote ownership predicate changes: consultation, never patient row.
create or replace function public.engine_complete_form_job(
  p_job_id uuid, p_attempt int, p_answers jsonb, p_metrics jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_engine uuid := (select auth.uid());
  v_job public.form_jobs;
  v_template jsonb;
  v_form_id uuid;
  v_previous uuid;
  v_answered int;
  v_status public.consultation_status;
begin
  if not private.is_engine() then return private.refuse('NOT_AN_ENGINE'); end if;
  perform 1 from public.consultations
    where id = (select consultation_id from public.form_jobs where id = p_job_id) for update;
  select * into v_job from public.form_jobs
    where id = p_job_id and attempt = p_attempt and status = 'processing' and engine_user_id = v_engine
    for update;
  if not found then return private.refuse('JOB_NOT_YOURS'); end if;
  select ft.definition into v_template from public.form_templates ft
    join public.consultations c on c.practitioner_id = ft.practitioner_id
    where c.id = v_job.consultation_id;

  begin
    if jsonb_typeof(p_answers) is distinct from 'array'
       or (select array_agg(a ->> 'key' order by a ->> 'key') from jsonb_array_elements(p_answers) a)
          is distinct from (select array_agg(f ->> 'key' order by f ->> 'key')
                            from jsonb_array_elements(v_template -> 'sections') s,
                                 jsonb_array_elements(s -> 'fields') f)
       or exists (select 1 from jsonb_array_elements(p_answers) a,
                           jsonb_array_elements_text(coalesce(a -> 'evidence', '[]')) e
                  where not exists (select 1 from public.transcript_segments s
                    where s.transcript_id = v_job.transcript_id and s.position = e::int))
       or exists (select 1 from jsonb_array_elements(p_answers) a,
                           jsonb_array_elements(coalesce(a -> 'documents', '[]')) q
                  where jsonb_typeof(q -> 'text') is distinct from 'string'
                     or char_length(q ->> 'text') not between 1 and 400
                     or not exists (select 1 from public.patient_documents d
                       where d.id = (q ->> 'document_id')::uuid
                         and d.consultation_id = v_job.consultation_id
                         and d.removed_at is null and d.reading = 'read'
                         and (q ->> 'page')::int between 1 and cardinality(d.page_texts)))
    then return private.refuse('VALIDATION', 'answers'); end if;

    select id into v_previous from public.forms
    where consultation_id = v_job.consultation_id and status <> 'superseded';
    update public.forms set status = 'superseded' where id = v_previous;
    insert into public.forms (consultation_id, job_id, transcript_id, template)
    values (v_job.consultation_id, v_job.id, v_job.transcript_id, v_template)
    returning id into v_form_id;
    insert into public.form_answers (
      form_id, field_key, position, machine_text, evidence, document_quotes
    )
    select v_form_id, f.field ->> 'key', f.position - 1,
      nullif(btrim(a ->> 'text'), ''),
      coalesce(array(select distinct e::int
                     from jsonb_array_elements_text(a -> 'evidence') e order by 1), '{}'),
      coalesce((select jsonb_agg(jsonb_build_object(
        'document_id', q ->> 'document_id', 'page', (q ->> 'page')::int, 'text', q ->> 'text'))
        from jsonb_array_elements(coalesce(a -> 'documents', '[]')) q), '[]'::jsonb)
    from (select field, row_number() over (order by si, fi) as position
          from jsonb_array_elements(v_template -> 'sections') with ordinality s(section, si),
               jsonb_array_elements(s.section -> 'fields') with ordinality x(field, fi)) f
    join jsonb_array_elements(p_answers) a on a ->> 'key' = f.field ->> 'key';
    update public.form_answers n set machine_text = o.machine_text, evidence = o.evidence,
      document_quotes = o.document_quotes, practitioner_text = o.practitioner_text, review = o.review
    from public.form_answers o
    where n.form_id = v_form_id and o.form_id = v_previous
      and o.field_key = n.field_key and o.review <> 'unreviewed';
    select count(*) into v_answered from public.form_answers
    where form_id = v_form_id and machine_text is not null;
  exception when others then
    return private.refuse('VALIDATION', 'answers');
  end;

  update public.form_jobs set status = 'completed', finished_at = now(),
    metrics = private.clean_metrics(p_metrics) where id = v_job.id;
  v_status := case when exists (select 1 from public.form_answers
                    where form_id = v_form_id and review <> 'unreviewed')
                   then 'under_review'::public.consultation_status
                   else 'draft_ready'::public.consultation_status end;
  update public.consultations set status = v_status, updated_at = now()
  where id = v_job.consultation_id;
  perform private.log_event(v_job.consultation_id, 'form.completed', v_engine::text, 'engine',
    'form', v_form_id, 'success', jsonb_build_object('job_id', v_job.id, 'attempt', v_job.attempt,
      'segment_count', v_answered, 'from_status', 'extraction_processing', 'to_status', v_status));
  return jsonb_build_object('ok', true, 'form_id', v_form_id);
end;
$$;
