-- Optional: profiles table for "who is signed up" (synced from auth.users).
-- Run in Supabase SQL editor or via migration. Backend GET /api/admin/users uses
-- auth.admin.listUsers(); this table allows querying profile fields from the app
-- or joining with other data.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  company text,
  requested_role text default 'viewer',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS: only service_role and authenticated own row
alter table public.profiles enable row level security;

create policy "users_read_own_profile"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

create policy "service_role_all"
  on public.profiles for all
  to service_role
  using (true)
  with check (true);

-- Trigger: create/update profile on auth.users insert or update
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, company, requested_role, updated_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'company',
    coalesce(new.raw_user_meta_data->>'requested_role', 'viewer'),
    now()
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, profiles.full_name),
    company = coalesce(excluded.company, profiles.company),
    requested_role = coalesce(excluded.requested_role, profiles.requested_role),
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_or_updated on auth.users;
create trigger on_auth_user_created_or_updated
  after insert or update on auth.users
  for each row execute function public.handle_new_user();

-- Backfill existing users (optional)
insert into public.profiles (id, email, full_name, company, requested_role, created_at, updated_at)
select
  id,
  email,
  coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name'),
  raw_user_meta_data->>'company',
  coalesce(raw_user_meta_data->>'requested_role', 'viewer'),
  created_at,
  now()
from auth.users
on conflict (id) do update set
  email = excluded.email,
  full_name = coalesce(excluded.full_name, profiles.full_name),
  company = coalesce(excluded.company, profiles.company),
  requested_role = coalesce(excluded.requested_role, profiles.requested_role),
  updated_at = now();

comment on table public.profiles is 'User profiles synced from auth.users; used for "who is signed up" and optional admin views.';
