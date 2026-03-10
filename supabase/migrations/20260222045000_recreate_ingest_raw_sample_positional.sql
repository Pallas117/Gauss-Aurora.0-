-- Recreate ingest_raw_sample with explicit parameter names to avoid
-- "column reference is ambiguous" errors in PostgreSQL function bodies.

drop function if exists public.ingest_raw_sample(text, text, timestamptz, jsonb);

create function public.ingest_raw_sample(
  p_source text,
  p_stream text,
  p_observed_at timestamptz,
  p_payload jsonb
)
returns void
language plpgsql
security definer
as $$
begin
  insert into public.sw_raw_samples (source, stream, observed_at, payload)
  values (p_source, p_stream, p_observed_at, p_payload)
  on conflict (source, stream, observed_at) do update
    set payload = excluded.payload,
        inserted_at = now();
end;
$$;
