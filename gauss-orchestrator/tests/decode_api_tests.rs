//! Integration tests for POST /telemetry/decode (decode API).

use axum::body::Body;
use axum::http::Request;
use gauss_orchestrator::{config::OrchestratorConfig, decode_api};
use http_body_util::BodyExt;
use std::path::PathBuf;
use std::sync::Arc;
use tower::ServiceExt;

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

#[tokio::test]
async fn post_telemetry_decode_returns_decoded_and_mapped_packets() {
    let config = test_config();
    let app = decode_api::router(Arc::new(config));
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/ccsds_valid.bin");
    println!("DEBUG: CARGO_MANIFEST_DIR = {}", env!("CARGO_MANIFEST_DIR"));
    println!("DEBUG: fixture path = {:?}", fixture);
    let bytes = std::fs::read(&fixture).expect("fixture must exist");

    let request = Request::builder()
        .method("POST")
        .uri("/telemetry/decode")
        .body(Body::from(bytes))
        .unwrap();

    let response: axum::response::Response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), 200);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(body.as_ref()).unwrap();

    assert_eq!(json["decoded_count"].as_u64(), Some(1));
    assert_eq!(json["mapped_count"].as_u64(), Some(1));
    let packets = json["packets"].as_array().expect("packets array");
    assert_eq!(packets.len(), 1);

    let point = &packets[0]["canonical_point"];
    assert!(point
        .get("solarWind")
        .and_then(|s| s.get("speed"))
        .is_some());
    assert!(point
        .get("solarWind")
        .and_then(|s| s.get("density"))
        .is_some());
    assert!(point
        .get("magneticField")
        .and_then(|m| m.get("z"))
        .is_some());

    let speed = point["solarWind"]["speed"].as_f64().unwrap();
    let density = point["solarWind"]["density"].as_f64().unwrap();
    let bz = point["magneticField"]["z"].as_f64().unwrap();
    assert!(speed.is_finite());
    assert!(density.is_finite());
    assert!(bz.is_finite());
}
