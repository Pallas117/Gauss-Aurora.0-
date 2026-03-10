use gauss_orchestrator::telemetry::ingest_client;
use gauss_orchestrator::{config::OrchestratorConfig, telemetry};
use reqwest::Client;
use std::net::TcpListener;
use std::path::PathBuf;
use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn can_bind_loopback() -> bool {
    TcpListener::bind("127.0.0.1:0").is_ok()
}

fn test_config(ingest_api_url: String) -> OrchestratorConfig {
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
        ingest_api_url,
        ingest_api_token: Some("orchestrator-secret".to_string()),
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
        ingest_retry_backoff_ms: 100,
        pipeline_api_url: None,
        triad_on_csv: false,
        surya_service_url: None,
        strict_local_inference: true,
        daily_summary_use_local: true,
    }
}

#[tokio::test]
async fn process_packet_file_posts_to_ingest_api() {
    if !can_bind_loopback() {
        eprintln!("Skipping process_packet_file_posts_to_ingest_api: loopback bind not permitted.");
        return;
    }

    let mock_server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/ingest/telemetry/packets"))
        .and(body_string_contains("\"source\":\"ccsds-orchestrator\""))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "accepted_count": 1,
            "rejected_count": 0,
            "errors": []
        })))
        .mount(&mock_server)
        .await;

    let cfg = test_config(format!(
        "{}/api/ingest/telemetry/packets",
        mock_server.uri()
    ));
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/ccsds_valid.bin");
    let client = Client::builder().no_proxy().build().expect("client");

    let report = telemetry::process_packet_file(&client, &fixture, &cfg)
        .await
        .expect("packet processing should succeed");

    assert_eq!(report.decoded_count, 1);
    assert_eq!(report.mapped_count, 1);
    assert_eq!(report.accepted_count, 1);
    assert_eq!(report.rejected_count, 0);
}

/// With ingest_retry_count: 0, no retries occur: one 5xx response yields an error.
#[tokio::test]
async fn ingest_retry_count_zero_does_not_retry() {
    if !can_bind_loopback() {
        eprintln!("Skipping ingest_retry_count_zero_does_not_retry: loopback bind not permitted.");
        return;
    }

    let mock_server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/ingest/telemetry/packets"))
        .respond_with(ResponseTemplate::new(503).set_body_string("service unavailable"))
        .mount(&mock_server)
        .await;

    let mut cfg = test_config(format!(
        "{}/api/ingest/telemetry/packets",
        mock_server.uri()
    ));
    cfg.ingest_retry_count = 0;
    cfg.ingest_retry_backoff_ms = 100;

    let client = Client::builder().no_proxy().build().expect("client");
    let request = ingest_client::PacketIngestRequest {
        run_id: "test-run".to_string(),
        source: "test".to_string(),
        format: "ccsds".to_string(),
        dictionary_id: "test-dict".to_string(),
        packets: vec![],
    };

    let result = ingest_client::post_ingest_packets(&client, &cfg, &request).await;
    assert!(result.is_err(), "with 0 retries, 503 should yield error");
}
