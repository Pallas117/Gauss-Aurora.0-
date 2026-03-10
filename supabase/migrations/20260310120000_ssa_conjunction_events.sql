create table if not exists public.ssa_conjunction_events (
  id text primary key,
  ingested_at timestamptz not null,
  format text not null,
  purpose text not null,
  source text,
  tca timestamptz,
  miss_distance_m double precision,
  relative_speed_m_s double precision,
  probability_of_collision double precision,
  primary_object jsonb not null default '{}'::jsonb,
  secondary_object jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  raw_excerpt text not null default '',
  updated_at timestamptz not null default now()
);

alter table if exists public.ssa_conjunction_events enable row level security;

revoke all on table public.ssa_conjunction_events from anon, authenticated;
grant select, insert, update, delete on table public.ssa_conjunction_events to service_role;
grant select on table public.ssa_conjunction_events to authenticated;

drop policy if exists "authenticated_read_ssa_conjunction_events" on public.ssa_conjunction_events;

create policy "authenticated_read_ssa_conjunction_events"
  on public.ssa_conjunction_events
  for select
  to authenticated
  using (true);
