alter table public.ssa_spacecraft_system_profiles
  add column if not exists expected_norad_ids jsonb,
  add column if not exists expected_object_count integer;

alter table public.ssa_spacecraft_system_profiles
  drop constraint if exists ssa_profile_expected_object_count;

alter table public.ssa_spacecraft_system_profiles
  add constraint ssa_profile_expected_object_count
  check (expected_object_count is null or (expected_object_count >= 1 and expected_object_count <= 100000));
