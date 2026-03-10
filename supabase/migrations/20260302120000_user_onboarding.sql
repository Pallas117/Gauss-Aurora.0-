-- Partner onboarding progress per user (device step, plan step, completion).
-- Backend GET/PATCH /api/auth/onboarding read/write via service_role.

create table if not exists public.user_onboarding (
  user_id uuid primary key references auth.users(id) on delete cascade,
  device_step_done boolean not null default false,
  plan_step_done boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_onboarding enable row level security;

create policy "users_read_own_onboarding"
  on public.user_onboarding for select
  to authenticated
  using (auth.uid() = user_id);

create policy "users_update_own_onboarding"
  on public.user_onboarding for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users_insert_own_onboarding"
  on public.user_onboarding for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "service_role_all"
  on public.user_onboarding for all
  to service_role
  using (true)
  with check (true);

comment on table public.user_onboarding is 'Partner onboarding: device (Turing) and plan steps; completed_at when both done or skipped.';
