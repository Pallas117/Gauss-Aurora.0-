create table if not exists public.ssa_spacecraft_system_health_evidence (
  system_id text not null,
  observed_at timestamptz not null,
  source text not null,
  telemetry_status text not null,
  damage_status text not null,
  evidence_types jsonb not null default '[]'::jsonb,
  provenance_url text,
  notes text,
  updated_at timestamptz not null default now(),
  primary key (system_id, observed_at)
);

alter table if exists public.ssa_spacecraft_system_health_evidence enable row level security;

revoke all on table public.ssa_spacecraft_system_health_evidence from anon, authenticated;
grant select, insert, update, delete on table public.ssa_spacecraft_system_health_evidence to service_role;
grant select on table public.ssa_spacecraft_system_health_evidence to authenticated;

drop policy if exists "authenticated_read_ssa_spacecraft_system_health_evidence" on public.ssa_spacecraft_system_health_evidence;

create policy "authenticated_read_ssa_spacecraft_system_health_evidence"
  on public.ssa_spacecraft_system_health_evidence
  for select
  to authenticated
  using (true);
