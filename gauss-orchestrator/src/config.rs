use std::time::Duration;

#[derive(Clone, Debug)]
pub struct OrchestratorConfig {
    pub local_engine_url: String,
    pub local_engine_model: String,
    pub local_engine_api_key: Option<String>,
    pub telemetry_dir: String,
    pub watch_debounce_ms: u64,
    pub cloud_enabled: bool,
    pub http_timeout_seconds: u64,
    pub decode_enabled: bool,
    pub xtce_path: String,
    pub apid_map_path: String,
    pub ingest_api_url: String,
    pub ingest_api_token: Option<String>,
    pub packet_max_batch: usize,
    pub packet_max_bytes: usize,
    pub packet_crc_enabled: bool,
    // Physics refinement and parse-rate gate
    pub min_parse_rate: f64,
    pub physics_validation: bool,
    pub physics_clamp: bool,
    pub refinement_api_url: Option<String>,
    pub physics_sigma_reject: bool,
    /// Max packets to use for 3-sigma rolling window (0 = use default 64).
    pub physics_sigma_window: usize,
    // LanceDB / SEU audit: checksum batch payload for verification when data is retrieved for LLM
    pub lancedb_checksum_log: bool,
    pub lancedb_url: Option<String>,
    /// When set, enable HTTP decode API (e.g. "127.0.0.1:8092"). POST /telemetry/decode returns decode+map JSON.
    pub decode_api_bind: Option<String>,
    /// When set, pass scheduler persists to this path (JSON file). ORCHESTRATOR_PASS_STORE_PATH.
    pub pass_store_path: Option<String>,
    /// Timeout in seconds for antenna commands (real adapters). Mock ignores. ORCHESTRATOR_ANTENNA_COMMAND_TIMEOUT_SECS.
    pub antenna_command_timeout_secs: u64,
    /// Retry count for antenna commands (real adapters). Mock ignores. ORCHESTRATOR_ANTENNA_COMMAND_RETRIES.
    pub antenna_command_retries: u32,
    /// Default role when X-Gauss-Role / X-Pass-API-Role not set. ORCHESTRATOR_PASS_API_DEFAULT_ROLE.
    pub pass_api_default_role: String,
    /// Max audit log entries to retain. ORCHESTRATOR_PASS_API_AUDIT_MAX_ENTRIES.
    pub pass_api_audit_max_entries: usize,
    /// When set, enable SSA fusion API (e.g. "127.0.0.1:8093"). POST /ssa/measurements, GET /ssa/tracks.
    pub ssa_api_bind: Option<String>,
    /// Number of retries for packet ingest POST on 5xx or connection error (0 = no retries). ORCHESTRATOR_INGEST_RETRY_COUNT.
    pub ingest_retry_count: u32,
    /// Base backoff in ms before first retry; exponential (base * 2^attempt). ORCHESTRATOR_INGEST_RETRY_BACKOFF_MS.
    pub ingest_retry_backoff_ms: u64,
    /// When set, orchestrator POSTs CSV path to this base URL + /api/ops/pipeline/triad to trigger Surya→DeepSeek triad. ORCHESTRATOR_PIPELINE_API_URL.
    pub pipeline_api_url: Option<String>,
    /// When true, trigger triad pipeline on each CSV drop (Rust-native when possible). ORCHESTRATOR_TRIAD_ON_CSV.
    pub triad_on_csv: bool,
    /// Optional Surya service URL for triad (e.g. http://127.0.0.1:8000). When unset, triad uses in-Rust stub. SURYA_SERVICE_URL.
    pub surya_service_url: Option<String>,
    /// When true, only local/trusted decision URLs (127.0.0.1, ::1, 100.x.x.x). No cloud LLM egress. Default true. ORCHESTRATOR_STRICT_LOCAL_INFERENCE.
    pub strict_local_inference: bool,
    /// When true, daily mission summary uses local engine only (no OpenAI egress). Default true. ORCHESTRATOR_DAILY_SUMMARY_USE_LOCAL.
    pub daily_summary_use_local: bool,
}

impl OrchestratorConfig {
    pub fn http_timeout(&self) -> Duration {
        Duration::from_secs(self.http_timeout_seconds)
    }
}

pub fn load_config() -> OrchestratorConfig {
    OrchestratorConfig {
        local_engine_url: std::env::var("ORCHESTRATOR_LOCAL_ENGINE_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8089/v1/chat/completions".to_string()),
        local_engine_model: std::env::var("ORCHESTRATOR_CHAT_MODEL")
            .unwrap_or_else(|_| "local-model".to_string()),
        local_engine_api_key: std::env::var("ORCHESTRATOR_LOCAL_ENGINE_API_KEY")
            .or_else(|_| std::env::var("DEEPSEEK_API_KEY"))
            .ok(),
        telemetry_dir: std::env::var("ORCHESTRATOR_TELEMETRY_DIR")
            .unwrap_or_else(|_| "./telemetry_drop".to_string()),
        watch_debounce_ms: std::env::var("ORCHESTRATOR_WATCH_DEBOUNCE_MS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(2000),
        cloud_enabled: std::env::var("ORCHESTRATOR_CLOUD_ENABLED")
            .ok()
            .map(|v| {
                let s = v.trim().to_lowercase();
                !["0", "false", "off", "no"].contains(&s.as_str())
            })
            .unwrap_or(false),
        http_timeout_seconds: std::env::var("ORCHESTRATOR_HTTP_TIMEOUT_SECONDS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(8),
        decode_enabled: std::env::var("ORCHESTRATOR_DECODE_ENABLED")
            .ok()
            .map(|v| {
                let s = v.trim().to_lowercase();
                !["0", "false", "off", "no"].contains(&s.as_str())
            })
            .unwrap_or(false),
        xtce_path: std::env::var("ORCHESTRATOR_XTCE_PATH")
            .unwrap_or_else(|_| "./gauss-orchestrator/config/xtce/baseline.xtce.xml".to_string()),
        apid_map_path: std::env::var("ORCHESTRATOR_APID_MAP_PATH")
            .unwrap_or_else(|_| "./gauss-orchestrator/config/xtce/apid-map.json".to_string()),
        ingest_api_url: std::env::var("ORCHESTRATOR_INGEST_API_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:3001/api/ingest/telemetry/packets".to_string()),
        ingest_api_token: std::env::var("ORCHESTRATOR_INGEST_API_TOKEN").ok(),
        packet_max_batch: std::env::var("ORCHESTRATOR_PACKET_MAX_BATCH")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(250),
        packet_max_bytes: std::env::var("ORCHESTRATOR_PACKET_MAX_BYTES")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(1_048_576),
        packet_crc_enabled: std::env::var("ORCHESTRATOR_PACKET_CRC_ENABLED")
            .ok()
            .map(|v| {
                let s = v.trim().to_lowercase();
                !["0", "false", "off", "no"].contains(&s.as_str())
            })
            .unwrap_or(false),
        min_parse_rate: std::env::var("ORCHESTRATOR_MIN_PARSE_RATE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(0.9),
        physics_validation: std::env::var("ORCHESTRATOR_PHYSICS_VALIDATION")
            .ok()
            .map(|v| {
                let s = v.trim().to_lowercase();
                !["0", "false", "off", "no"].contains(&s.as_str())
            })
            .unwrap_or(true),
        physics_clamp: std::env::var("ORCHESTRATOR_PHYSICS_CLAMP")
            .ok()
            .map(|v| {
                let s = v.trim().to_lowercase();
                !["0", "false", "off", "no"].contains(&s.as_str())
            })
            .unwrap_or(true),
        refinement_api_url: std::env::var("ORCHESTRATOR_REFINEMENT_API_URL").ok().filter(|s| !s.trim().is_empty()),
        physics_sigma_reject: std::env::var("ORCHESTRATOR_PHYSICS_SIGMA_REJECT")
            .ok()
            .map(|v| {
                let s = v.trim().to_lowercase();
                ["1", "true", "on", "yes"].contains(&s.as_str())
            })
            .unwrap_or(false),
        physics_sigma_window: std::env::var("ORCHESTRATOR_PHYSICS_SIGMA_WINDOW")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(64),
        lancedb_checksum_log: std::env::var("ORCHESTRATOR_LANCEDB_CHECKSUM_LOG")
            .ok()
            .map(|v| {
                let s = v.trim().to_lowercase();
                !["0", "false", "off", "no"].contains(&s.as_str())
            })
            .unwrap_or(true),
        lancedb_url: std::env::var("ORCHESTRATOR_LANCEDB_URL").ok().filter(|s| !s.trim().is_empty()),
        decode_api_bind: std::env::var("ORCHESTRATOR_DECODE_API_BIND").ok().filter(|s| !s.trim().is_empty()),
        pass_store_path: std::env::var("ORCHESTRATOR_PASS_STORE_PATH").ok().filter(|s| !s.trim().is_empty()),
        antenna_command_timeout_secs: std::env::var("ORCHESTRATOR_ANTENNA_COMMAND_TIMEOUT_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(30),
        antenna_command_retries: std::env::var("ORCHESTRATOR_ANTENNA_COMMAND_RETRIES")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(3),
        pass_api_default_role: std::env::var("ORCHESTRATOR_PASS_API_DEFAULT_ROLE")
            .unwrap_or_else(|_| "operator".to_string()),
        pass_api_audit_max_entries: std::env::var("ORCHESTRATOR_PASS_API_AUDIT_MAX_ENTRIES")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(1000),
        ssa_api_bind: std::env::var("ORCHESTRATOR_SSA_API_BIND").ok().filter(|s| !s.trim().is_empty()),
        ingest_retry_count: std::env::var("ORCHESTRATOR_INGEST_RETRY_COUNT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(3),
        ingest_retry_backoff_ms: std::env::var("ORCHESTRATOR_INGEST_RETRY_BACKOFF_MS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(1000),
        pipeline_api_url: std::env::var("ORCHESTRATOR_PIPELINE_API_URL")
            .ok()
            .filter(|s| !s.trim().is_empty()),
        triad_on_csv: std::env::var("ORCHESTRATOR_TRIAD_ON_CSV")
            .ok()
            .map(|v| {
                let s = v.trim().to_lowercase();
                !["0", "false", "off", "no"].contains(&s.as_str())
            })
            .unwrap_or(false),
        surya_service_url: std::env::var("SURYA_SERVICE_URL")
            .ok()
            .filter(|s| !s.trim().is_empty()),
        strict_local_inference: std::env::var("ORCHESTRATOR_STRICT_LOCAL_INFERENCE")
            .ok()
            .map(|v| {
                let s = v.trim().to_lowercase();
                !["0", "false", "off", "no"].contains(&s.as_str())
            })
            .unwrap_or(true),
        daily_summary_use_local: std::env::var("ORCHESTRATOR_DAILY_SUMMARY_USE_LOCAL")
            .ok()
            .map(|v| {
                let s = v.trim().to_lowercase();
                !["0", "false", "off", "no"].contains(&s.as_str())
            })
            .unwrap_or(true),
    }
}

#[cfg(test)]
mod tests {
    use super::load_config;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn save_env(keys: &[&str]) -> Vec<(String, Option<String>)> {
        keys.iter()
            .map(|key| ((*key).to_string(), std::env::var(key).ok()))
            .collect()
    }

    fn restore_env(snapshot: Vec<(String, Option<String>)>) {
        for (key, value) in snapshot {
            if let Some(value) = value {
                std::env::set_var(key, value);
            } else {
                std::env::remove_var(key);
            }
        }
    }

    #[test]
    fn load_config_uses_defaults_when_env_missing() {
        let _guard = ENV_LOCK.lock().expect("env lock poisoned");
        let keys = [
            "ORCHESTRATOR_LOCAL_ENGINE_URL",
            "ORCHESTRATOR_CHAT_MODEL",
            "ORCHESTRATOR_DECODE_ENABLED",
            "ORCHESTRATOR_INGEST_RETRY_COUNT",
            "ORCHESTRATOR_INGEST_RETRY_BACKOFF_MS",
        ];
        let snapshot = save_env(&keys);
        for key in keys {
            std::env::remove_var(key);
        }

        let cfg = load_config();
        assert_eq!(cfg.local_engine_url, "http://127.0.0.1:8089/v1/chat/completions");
        assert_eq!(cfg.local_engine_model, "local-model");
        assert!(!cfg.decode_enabled);
        assert_eq!(cfg.ingest_retry_count, 3);
        assert_eq!(cfg.ingest_retry_backoff_ms, 1000);

        restore_env(snapshot);
    }

    #[test]
    fn load_config_applies_env_overrides() {
        let _guard = ENV_LOCK.lock().expect("env lock poisoned");
        let keys = [
            "ORCHESTRATOR_LOCAL_ENGINE_URL",
            "ORCHESTRATOR_CHAT_MODEL",
            "ORCHESTRATOR_DECODE_ENABLED",
            "ORCHESTRATOR_INGEST_RETRY_COUNT",
            "ORCHESTRATOR_INGEST_RETRY_BACKOFF_MS",
            "ORCHESTRATOR_STRICT_LOCAL_INFERENCE",
            "ORCHESTRATOR_DAILY_SUMMARY_USE_LOCAL",
        ];
        let snapshot = save_env(&keys);

        std::env::set_var("ORCHESTRATOR_LOCAL_ENGINE_URL", "http://127.0.0.1:9999/v1/chat/completions");
        std::env::set_var("ORCHESTRATOR_CHAT_MODEL", "test-model");
        std::env::set_var("ORCHESTRATOR_DECODE_ENABLED", "true");
        std::env::set_var("ORCHESTRATOR_INGEST_RETRY_COUNT", "7");
        std::env::set_var("ORCHESTRATOR_INGEST_RETRY_BACKOFF_MS", "2500");
        std::env::set_var("ORCHESTRATOR_STRICT_LOCAL_INFERENCE", "false");
        std::env::set_var("ORCHESTRATOR_DAILY_SUMMARY_USE_LOCAL", "no");

        let cfg = load_config();
        assert_eq!(cfg.local_engine_url, "http://127.0.0.1:9999/v1/chat/completions");
        assert_eq!(cfg.local_engine_model, "test-model");
        assert!(cfg.decode_enabled);
        assert_eq!(cfg.ingest_retry_count, 7);
        assert_eq!(cfg.ingest_retry_backoff_ms, 2500);
        assert!(!cfg.strict_local_inference);
        assert!(!cfg.daily_summary_use_local);

        restore_env(snapshot);
    }
}
