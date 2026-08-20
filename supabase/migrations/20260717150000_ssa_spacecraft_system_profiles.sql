create table if not exists public.ssa_spacecraft_system_profiles (
  system_id text primary key,
  name_patterns jsonb not null,
  mission_type text not null,
  operator text,
  observed_at timestamptz not null,
  source text not null,
  provenance_urls jsonb not null default '[]'::jsonb,
  notes text,
  updated_at timestamptz not null default now(),
  constraint ssa_profile_system_format check (system_id ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  constraint ssa_profile_mission_type check (mission_type in ('crewed_leo','navigation_meo','communications_leo','communications_geo','earth_observation','weather','unknown'))
);

alter table public.ssa_spacecraft_system_profiles enable row level security;

create policy "mission operators can read spacecraft system profiles"
  on public.ssa_spacecraft_system_profiles for select
  using (public.is_staff() and public.has_clearance('mission'));

create policy "mission operators can write spacecraft system profiles"
  on public.ssa_spacecraft_system_profiles for all
  using (public.is_staff() and public.has_clearance('mission'))
  with check (public.is_staff() and public.has_clearance('mission'));
