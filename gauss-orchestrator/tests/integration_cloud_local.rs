use gauss_orchestrator::{config::OrchestratorConfig, routing};
use reqwest::Client;
use std::net::TcpListener;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn can_bind_loopback() -> bool {
    TcpListener::bind("127.0.0.1:0").is_ok()
}

#[tokio::test]
async fn test_route_to_local_posts_and_returns_local() {
    if !can_bind_loopback() {
        eprintln!(
            "Skipping test_route_to_local_posts_and_returns_local: loopback bind not permitted."
        );
        return;
    }

    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;

    let client = Client::builder().no_proxy().build().expect("client");
    let cfg = OrchestratorConfig {
        local_engine_url: format!("{}/v1/chat/completions", server.uri()),
        local_engine_model: "local-model".to_string(),
        local_engine_api_key: None,
        telemetry_dir: "./tmp".to_string(),
        watch_debounce_ms: 1000,
        cloud_enabled: true,
        http_timeout_seconds: 5,
        decode_enabled: false,
        xtce_path: "./config/xtce/baseline.xtce.xml".to_string(),
        apid_map_path: "./config/xtce/apid-map.json".to_string(),
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
        strict_local_inference: false,
        daily_summary_use_local: true,
    };

    let res = routing::route_to_local(&client, "SAMPLE TELEMETRY", &cfg).await;
    assert!(
        res.is_ok(),
        "route_to_local returned error: {:?}",
        res.err()
    );
    let dec = res.unwrap();
    use gauss_orchestrator::types::RoutingTarget;
    assert!(matches!(dec.target, RoutingTarget::Local));
    assert!(!dec.anonymized);
}

#[tokio::test]
async fn test_route_to_cloud_no_api_key_anonymizes() {
    // Ensure env has no key
    std::env::remove_var("ORCHESTRATOR_OPENAI_API_KEY");
    std::env::remove_var("OPENAI_API_KEY");

    let client = Client::builder().no_proxy().build().expect("client");
    let cfg = OrchestratorConfig {
        local_engine_url: "http://localhost:1234".to_string(),
        local_engine_model: "local-model".to_string(),
        local_engine_api_key: None,
        telemetry_dir: "./tmp".to_string(),
        watch_debounce_ms: 1000,
        cloud_enabled: true,
        http_timeout_seconds: 5,
        decode_enabled: false,
        xtce_path: "./config/xtce/baseline.xtce.xml".to_string(),
        apid_map_path: "./config/xtce/apid-map.json".to_string(),
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
        strict_local_inference: false,
        daily_summary_use_local: true,
    };

    let res = routing::route_to_cloud(&client, "Satellite_ID_001,Lat:42.5,Lon:-73.2", &cfg).await;
    assert!(
        res.is_ok(),
        "route_to_cloud returned error: {:?}",
        res.err()
    );
    let dec = res.unwrap();
    use gauss_orchestrator::types::RoutingTarget;
    assert!(matches!(dec.target, RoutingTarget::Cloud));
    assert!(dec.anonymized);
}
