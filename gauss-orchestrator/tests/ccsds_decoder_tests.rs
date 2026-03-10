use gauss_orchestrator::{config::OrchestratorConfig, telemetry::decoder_registry};
use std::path::PathBuf;

fn test_config() -> OrchestratorConfig {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    OrchestratorConfig {
        local_engine_url: "http://127.0.0.1:9999".to_string(),
        local_engine_model: "local-model".to_string(),
        local_engine_api_key: None,
        telemetry_dir: "./tmp".to_string(),
        watch_debounce_ms: 1000,
        cloud_enabled: true,
        http_timeout_seconds: 5,
        decode_enabled: true,
        xtce_path: root
            .join("config/xtce/baseline.xtce.xml")
            .to_string_lossy()
            .to_string(),
        apid_map_path: root
            .join("config/xtce/apid-map.json")
            .to_string_lossy()
            .to_string(),
        ingest_api_url: "http://127.0.0.1:3001/api/ingest/telemetry/packets".to_string(),
        ingest_api_token: None,
        packet_max_batch: 250,
        packet_max_bytes: 1_048_576,
        packet_crc_enabled: false,
        min_parse_rate: 0.9,
        physics_validation: true,
        physics_clamp: true,
        refinement_api_url: None,
        physics_sigma_reject: false,
        physics_sigma_window: 64,
        lancedb_checksum_log: false,
        lancedb_url: None,
        decode_api_bind: None,
        pass_store_path: None,
        antenna_command_timeout_secs: 30,
        antenna_command_retries: 3,
        pass_api_default_role: "operator".to_string(),
        pass_api_audit_max_entries: 1000,
        ssa_api_bind: None,
        ingest_retry_count: 3,
        ingest_retry_backoff_ms: 1000,
        pipeline_api_url: None,
        triad_on_csv: false,
        surya_service_url: None,
        strict_local_inference: true,
        daily_summary_use_local: true,
    }
}

#[test]
fn decodes_valid_ccsds_binary_packet() {
    let cfg = test_config();
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/ccsds_valid.bin");
    let bytes = std::fs::read(&fixture).expect("fixture must exist");
    let batch = decoder_registry::decode_packet_file(&fixture, &bytes, &cfg)
        .expect("decode should succeed");

    assert_eq!(batch.packets.len(), 1);
    assert!(batch.errors.is_empty());
    let packet = &batch.packets[0];
    assert_eq!(packet.apid, 900);
    assert_eq!(packet.seq_count, 42);
    assert_eq!(packet.payload_hex, "43E1400040E66666C0466666");
}

#[test]
fn rejects_malformed_short_packet_with_invalid_length() {
    let cfg = test_config();
    let fixture =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/ccsds_invalid_length.bin");
    let bytes = std::fs::read(&fixture).expect("fixture must exist");
    let batch =
        decoder_registry::decode_packet_file(&fixture, &bytes, &cfg).expect("decode should run");

    assert_eq!(batch.packets.len(), 0);
    assert!(!batch.errors.is_empty());
    assert!(batch
        .errors
        .iter()
        .any(|error| error.code == "invalid_length"));
}

#[test]
fn flags_crc_mismatch_when_crc_enabled_without_crc_trailer() {
    let mut cfg = test_config();
    cfg.packet_crc_enabled = true;

    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/ccsds_valid.bin");
    let bytes = std::fs::read(&fixture).expect("fixture must exist");
    let batch =
        decoder_registry::decode_packet_file(&fixture, &bytes, &cfg).expect("decode should run");

    assert_eq!(batch.packets.len(), 0);
    assert!(batch
        .errors
        .iter()
        .any(|error| error.code == "crc_mismatch"));
}
