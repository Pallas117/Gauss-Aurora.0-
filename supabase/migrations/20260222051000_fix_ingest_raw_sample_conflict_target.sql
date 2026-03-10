-- Resolve source/stream/observed_at ambiguity by using explicit conflict
-- constraint instead of column-list conflict target.

drop function if exists public.ingest_raw_sample(text, text, timestamptz, jsonb);

create function public.ingest_raw_sample(
  source text,
  stream text,
  observed_at timestamptz,
  payload jsonb
)
returns void
language plpgsql
security definer
as $$
begin
  insert into public.sw_raw_samples (source, stream, observed_at, payload)
  values ($1, $2, $3, $4)
  on conflict on constraint sw_raw_samples_source_stream_observed_at_key do update
    set payload = excluded.payload,
        inserted_at = now();
end;
$$;
