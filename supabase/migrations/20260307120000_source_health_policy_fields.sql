alter table if exists public.source_health
  add column if not exists power_decision text,
  add column if not exists utility_score double precision,
  add column if not exists target_cadence_ms integer,
  add column if not exists policy_reason text,
  add column if not exists observed_cost_score double precision,
  add column if not exists avg_fetch_duration_ms double precision,
  add column if not exists avg_cpu_ms double precision,
  add column if not exists avg_payload_kb double precision,
  add column if not exists sample_count integer,
  add column if not exists override_decision text,
  add column if not exists override_target_cadence_ms integer,
  add column if not exists override_reason text,
  add column if not exists override_updated_at timestamptz,
  add column if not exists override_updated_by text;

