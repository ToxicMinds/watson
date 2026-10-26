-- Show all practitioners in the list; availability is handled on the booking page.
create or replace function public.find_practitioners() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('ok', true, 'practitioners', coalesce(jsonb_agg(
      private.public_page(p) || jsonb_build_object('next_free',
        (select min(t.starts_at) from private.open_times(p, now(), now() + interval '28 days') t))
      order by p.display_name), '[]'::jsonb))
  from public.practitioner_profiles p;
$$;
