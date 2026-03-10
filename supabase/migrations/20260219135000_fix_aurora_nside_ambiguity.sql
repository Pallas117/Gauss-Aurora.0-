-- Fix ambiguous reference between function args and table columns.
-- Also normalize argument names to p_ts/p_nside to avoid PostgreSQL
-- "cannot change name of input parameter" errors on CREATE OR REPLACE.
drop function if exists public.build_aurora_healpix_map(timestamptz, integer);

create function public.build_aurora_healpix_map(
  p_ts timestamptz,
  p_nside integer default 64
)
returns void
language plpgsql
security definer
as $$
declare
  latest_point jsonb;
  map_payload jsonb;
  harmonics_payload jsonb;
begin
  select point into latest_point
  from public.sw_nowcast_5s
  where timestamp <= p_ts
  order by timestamp desc
  limit 1;

  if latest_point is null then
    return;
  end if;

  map_payload := jsonb_build_object(
    'nside', p_nside,
    'generated_at', p_ts,
    'kp', coalesce((latest_point #>> '{indices,kp}')::double precision, 2),
    'driver_bz', coalesce((latest_point #>> '{magneticField,z}')::double precision, 0)
  );

  harmonics_payload := jsonb_build_object(
    'lMax', 8,
    'powerSpectrum', jsonb_build_array(
      jsonb_build_object('l', 0, 'cL', 1.0),
      jsonb_build_object('l', 1, 'cL', 0.7),
      jsonb_build_object('l', 2, 'cL', 0.4)
    )
  );

  insert into public.aurora_healpix_maps (timestamp, nside, map, harmonics)
  values (p_ts, p_nside, map_payload, harmonics_payload)
  on conflict (timestamp, nside) do update
    set map = excluded.map,
        harmonics = excluded.harmonics,
        inserted_at = now();
end;
$$;
