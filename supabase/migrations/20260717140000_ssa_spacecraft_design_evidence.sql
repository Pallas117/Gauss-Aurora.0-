create table if not exists public.ssa_spacecraft_design_evidence (
  evidence_key text primary key generated always as (
    case when norad_id is not null then 'norad:' || norad_id else 'system:' || system_id end
  ) stored,
  norad_id text,
  system_id text,
  observed_at timestamptz not null,
  source text not null,
  shielding_areal_density_gcm2 double precision,
  dose_limit_krad_si double precision,
  see_qualification_url text,
  evidence_types jsonb not null default '[]'::jsonb,
  provenance_url text,
  notes text,
  updated_at timestamptz not null default now(),
  constraint ssa_design_one_target check ((norad_id is not null) <> (system_id is not null)),
  constraint ssa_design_norad_format check (norad_id is null or norad_id ~ '^[0-9]{1,8}$'),
  constraint ssa_design_system_format check (system_id is null or system_id ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  constraint ssa_design_shielding_range check (shielding_areal_density_gcm2 is null or (shielding_areal_density_gcm2 >= 0 and shielding_areal_density_gcm2 <= 1000)),
  constraint ssa_design_dose_range check (dose_limit_krad_si is null or (dose_limit_krad_si >= 0 and dose_limit_krad_si <= 100000))
);

alter table public.ssa_spacecraft_design_evidence enable row level security;

create policy "mission operators can read spacecraft design evidence"
  on public.ssa_spacecraft_design_evidence for select
  using (public.is_staff() and public.has_clearance('mission'));

create policy "mission operators can write spacecraft design evidence"
  on public.ssa_spacecraft_design_evidence for all
  using (public.is_staff() and public.has_clearance('mission'))
  with check (public.is_staff() and public.has_clearance('mission'));
