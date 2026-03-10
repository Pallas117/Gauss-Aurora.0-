-- Operator-managed data sources and satellite hardware registry (operator portal onboarding)
-- Backend uses service_role for all mutations; RLS restricts direct client writes.

create table if not exists public.operator_data_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null,
  endpoint_url text,
  config jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.operator_satellite_hardware (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null,
  data_source_id uuid references public.operator_data_sources(id) on delete set null,
  connection_hint text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

alter table public.operator_data_sources enable row level security;
alter table public.operator_satellite_hardware enable row level security;

revoke all on table public.operator_data_sources from anon, authenticated;
revoke all on table public.operator_satellite_hardware from anon, authenticated;

grant select, insert, update, delete on table public.operator_data_sources to service_role;
grant select, insert, update, delete on table public.operator_satellite_hardware to service_role;
grant select on table public.operator_data_sources to authenticated;
grant select on table public.operator_satellite_hardware to authenticated;

create policy "authenticated_read_operator_data_sources"
  on public.operator_data_sources for select to authenticated using (true);

create policy "authenticated_read_operator_satellite_hardware"
  on public.operator_satellite_hardware for select to authenticated using (true);
