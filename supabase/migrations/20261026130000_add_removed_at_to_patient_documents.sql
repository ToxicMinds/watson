-- Keep an ownership-bearing tombstone until the trusted Storage API cleanup finishes.
alter table public.patient_documents
  add column if not exists removed_at timestamptz,
  add column if not exists cleanup_completed_at timestamptz;

-- Normalize tombstones created by an earlier partial rollout before exposing retry UI.
update public.patient_documents
  set reading = 'failed', page_texts = null, engine_user_id = null,
      claimed_at = null, read_at = null, error_category = 'DOCUMENT_REMOVED'
  where removed_at is not null;

comment on column public.patient_documents.removed_at is
  'Tombstone timestamp: revoke all document reads while trusted Storage cleanup is pending';
comment on column public.patient_documents.cleanup_completed_at is
  'Set only after trusted cleanup confirms the Storage object is absent';

-- Tombstones must not consume the consultation's active-document upload limit.
create or replace function private.add_document(
  p_consultation public.consultations, p_file_name text, p_media_type text, p_size_bytes int, p_source text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_path text := p_consultation.practitioner_id::text || '/' || v_id::text;
  v_name text := btrim(regexp_replace(coalesce(p_file_name, ''), '[/\\[:cntrl:]]', '', 'g'));
begin
  if p_consultation.patient_id is null then
    return private.refuse('PATIENT_MISSING');
  end if;
  if char_length(v_name) not between 1 and 200 then
    return private.refuse('VALIDATION', 'file_name');
  end if;
  if p_media_type is null or p_media_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') then
    return private.refuse('DOCUMENT_FORMAT_UNSUPPORTED');
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 then
    return private.refuse('VALIDATION', 'size_bytes');
  end if;
  if p_size_bytes > 10485760 then
    return private.refuse('DOCUMENT_TOO_LARGE');
  end if;
  if (select count(*) from public.patient_documents
      where consultation_id = p_consultation.id and removed_at is null) >= 20 then
    return private.refuse('DOCUMENT_LIMIT');
  end if;
  insert into public.patient_documents (id, practitioner_id, patient_id, consultation_id, storage_path,
                                        file_name, media_type, size_bytes, source)
    values (v_id, p_consultation.practitioner_id, p_consultation.patient_id, p_consultation.id, v_path,
            v_name, p_media_type, p_size_bytes, p_source);
  return jsonb_build_object('ok', true, 'document_id', v_id, 'path', v_path);
end;
$$;

-- An absent or tombstoned authorization row must never grant read access.
create or replace function private.document_access(p_object_name text, p_action text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case p_action
    when 'add' then exists (
      select 1 from public.patient_documents d
      where d.storage_path = p_object_name and d.removed_at is null
        and d.uploaded_at is null and d.created_at > now() - interval '30 minutes'
        and (d.source = 'patient' or d.practitioner_id = (select auth.uid())))
    when 'read' then exists (
      select 1 from public.patient_documents d
      where d.storage_path = p_object_name and d.removed_at is null
        and (d.practitioner_id = (select auth.uid())
             or (d.reading = 'reading' and d.engine_user_id = (select auth.uid()))))
    -- Only the trusted service-role cleanup function removes Storage objects.
    when 'remove' then false
    else false
  end;
$$;

drop policy if exists "Documents are added only to a record waiting for its file" on storage.objects;
create policy "Documents are added only to a record waiting for its file"
  on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'documents' and private.document_access(name, 'add'));
drop policy if exists "Documents are read by their practitioner and the engine" on storage.objects;
create policy "Documents are read by their practitioner and the engine"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'documents' and private.document_access(name, 'read'));
drop policy if exists "Documents are removed once no record points at them" on storage.objects;
create policy "Documents are removed once no record points at them"
  on storage.objects for delete to anon, authenticated
  using (bucket_id = 'documents' and private.document_access(name, 'remove'));

-- A narrow service-only completion marker; do not remove the tombstone row.
create or replace function private.complete_document_cleanup(p_document_id uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update public.patient_documents d
    set cleanup_completed_at = coalesce(cleanup_completed_at, now())
    where d.id = p_document_id and d.removed_at is not null
      and not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'documents' and o.name = d.storage_path
      );
  return found;
end;
$$;
revoke all on function private.complete_document_cleanup(uuid) from public, anon, authenticated, service_role;
grant execute on function private.complete_document_cleanup(uuid) to service_role;

create or replace function public.complete_document_cleanup(p_document_id uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  return private.complete_document_cleanup(p_document_id);
end;
$$;
revoke all on function public.complete_document_cleanup(uuid) from public, anon, authenticated, service_role;
grant execute on function public.complete_document_cleanup(uuid) to service_role;

-- Replace the historical deletion RPCs: tombstone first, then let the trusted
-- cleanup Edge Function delete through the Storage API. Repeated requests are safe.
create or replace function public.patient_remove_document(p_token text, p_document_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_document public.patient_documents;
begin
  update public.patient_documents d
    set removed_at = coalesce(d.removed_at, now()),
        reading = 'failed', page_texts = null, engine_user_id = null,
        claimed_at = null, read_at = null, error_category = 'DOCUMENT_REMOVED'
    where d.id = p_document_id and d.source = 'patient' and d.removed_at is null
      and d.consultation_id = (select id from private.consultation_for_token(p_token));
  if not found then
    select d.* into v_document from public.patient_documents d
      where d.id = p_document_id and d.source = 'patient' and d.removed_at is not null
        and d.consultation_id = (select id from public.consultations where invite_token = p_token);
    if not found then return private.refuse('NOT_FOUND'); end if;
  else
    select * into v_document from public.patient_documents where id = p_document_id;
    if v_document.uploaded_at is not null then
      perform private.log_event(v_document.consultation_id, 'document.removed', 'patient', 'patient',
        'patient_document', v_document.id, 'success', jsonb_build_object('source', v_document.source));
    end if;
  end if;
  return jsonb_build_object('ok', true, 'path', v_document.storage_path,
    'cleanup_completed', v_document.cleanup_completed_at is not null);
end;
$$;

create or replace function public.remove_document(p_document_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_document public.patient_documents;
begin
  update public.patient_documents d
    set removed_at = coalesce(d.removed_at, now()),
        reading = 'failed', page_texts = null, engine_user_id = null,
        claimed_at = null, read_at = null, error_category = 'DOCUMENT_REMOVED'
    where d.id = p_document_id and d.practitioner_id = (select auth.uid()) and d.removed_at is null;
  if not found then
    select d.* into v_document from public.patient_documents d
      where d.id = p_document_id and d.practitioner_id = (select auth.uid()) and d.removed_at is not null;
    if not found then return private.refuse('NOT_FOUND'); end if;
  else
    select * into v_document from public.patient_documents where id = p_document_id;
    if v_document.uploaded_at is not null then
      perform private.log_event(v_document.consultation_id, 'document.removed', (select auth.uid())::text,
        'practitioner', 'patient_document', v_document.id, 'success', jsonb_build_object('source', v_document.source));
    end if;
  end if;
  return jsonb_build_object('ok', true, 'path', v_document.storage_path,
    'cleanup_completed', v_document.cleanup_completed_at is not null);
end;
$$;

-- A removed document cannot be re-queued, which would restore extracted content
-- or let an engine attempt a read after its Storage authorization was revoked.
create or replace function public.read_document_again(p_document_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  update public.patient_documents
    set reading = 'waiting', reading_attempt = 0, error_category = null, read_at = null
    where id = p_document_id and practitioner_id = (select auth.uid())
      and removed_at is null and reading in ('unreadable', 'failed') and uploaded_at is not null;
  if not found then return private.refuse('NOT_FOUND'); end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Keep pending-removal rows visible on the patient link so they can retry cleanup.
create or replace function public.invite_details(p_token text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('ok', true, 'scheduled_at', c.scheduled_at, 'fee_cents', c.fee_cents,
              'currency', 'eur', 'paid', c.paid_at is not null, 'paid_at', c.paid_at,
              'whatsapp_code', c.whatsapp_code,
              'booked_from', case when c.booked_at is not null then
                (select p.slug from public.practitioner_profiles p where p.practitioner_id = c.practitioner_id) end,
              'patient', (select jsonb_build_object('name', p.name, 'contact', coalesce(p.phone, p.email))
                          from public.patients p where p.id = c.patient_id),
              'documents', (select coalesce(jsonb_agg(jsonb_build_object(
                                'id', d.id, 'file_name', d.file_name, 'media_type', d.media_type,
                                'size_bytes', d.size_bytes, 'created_at', d.created_at,
                                'removed_at', d.removed_at,
                                'cleanup_completed_at', d.cleanup_completed_at)
                              order by d.created_at), '[]'::jsonb)
                            from public.patient_documents d
                            where d.consultation_id = c.id
                              and (d.uploaded_at is not null or d.removed_at is not null)))
      from private.consultation_for_token(p_token) c
      where c.id is not null),
    private.refuse('NOT_FOUND'));
$$;
