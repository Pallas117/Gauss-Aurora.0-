-- Failure reports from client (crashes, unhandled errors, exits) for auto-fix or ticket creation.
-- Only backend (service_role) can insert; RLS blocks anon/authenticated writes.

create table if not exists public.failure_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  type text not null,
  message text not null,
  stack text,
  page text,
  user_agent text,
  payload jsonb,
  user_id uuid
);

alter table public.failure_reports enable row level security;

revoke all on table public.failure_reports from anon, authenticated;
grant select, insert on table public.failure_reports to service_role;

-- No policy for anon/authenticated: only service_role can write.
