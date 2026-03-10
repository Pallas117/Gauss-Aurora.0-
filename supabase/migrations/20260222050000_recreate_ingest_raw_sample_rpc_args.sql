-- Recreate ingest_raw_sample with RPC-compatible argument names while using
-- positional references to avoid SQL ambiguity in function body.

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
  on conflict (source, stream, observed_at) do update
    set payload = excluded.payload,
        inserted_at = now();
end;
$$;
