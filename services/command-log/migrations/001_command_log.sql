-- Command log for mission commands (trigger-nowcast, schedule-pass, log-health-check, etc.)
CREATE TABLE IF NOT EXISTS command_log (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  command_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  role TEXT,
  user_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_command_log_created_at ON command_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_command_log_command_type ON command_log (command_type);
