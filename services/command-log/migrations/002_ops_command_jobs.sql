-- Durable command queue with idempotency metadata and execution lifecycle.
CREATE TABLE IF NOT EXISTS ops_command_jobs (
  job_id UUID PRIMARY KEY,
  command_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  source TEXT NOT NULL CHECK (source IN ('manual', 'deepseek')),
  status TEXT NOT NULL CHECK (status IN ('planned', 'running', 'succeeded', 'failed')),
  simulate BOOLEAN NOT NULL DEFAULT false,
  idempotency_key TEXT,
  requested_by TEXT,
  power_constrained BOOLEAN NOT NULL DEFAULT false,
  heavy_command BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  result JSONB,
  error TEXT,
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ops_command_jobs_created_at
  ON ops_command_jobs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ops_command_jobs_status_created_at
  ON ops_command_jobs (status, created_at);

CREATE INDEX IF NOT EXISTS idx_ops_command_jobs_idempotency_created_at
  ON ops_command_jobs (idempotency_key, created_at DESC);
