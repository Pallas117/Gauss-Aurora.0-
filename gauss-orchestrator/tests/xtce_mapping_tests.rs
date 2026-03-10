use gauss_orchestrator::{
    config::OrchestratorConfig,
    telemetry::{decoder_registry, mapping, quality, xtce, decode_and_map_packets, DecodedPacket},
};
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
fn maps_decoded_packet_to_canonical_schema() {
    let cfg = test_config();
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/ccsds_valid.bin");
    let bytes = std::fs::read(&fixture).expect("fixture must exist");
    let batch = decoder_registry::decode_packet_file(&fixture, &bytes, &cfg)
        .expect("decode should succeed");

    let dictionary = xtce::load_xtce_dictionary(PathBuf::from(&cfg.xtce_path).as_path())
        .expect("xtce dictionary should load");
    let apid_map = mapping::load_apid_map(PathBuf::from(&cfg.apid_map_path).as_path(), &dictionary)
        .expect("apid map should load");

    let (mapped, errors) =
        mapping::map_decoded_packets(&fixture, &batch.packets, &apid_map, &dictionary);
    assert_eq!(mapped.len(), 1);
    assert!(errors.is_empty());

    let point = &mapped[0].canonical_point;
    let speed = point["solarWind"]["speed"].as_f64().unwrap_or_default();
    let density = point["solarWind"]["density"].as_f64().unwrap_or_default();
    let bz = point["magneticField"]["z"].as_f64().unwrap_or_default();
    assert!((speed - 450.5).abs() < 0.01);
    assert!((density - 7.2).abs() < 0.01);
    assert!((bz - (-3.1)).abs() < 0.01);
}

#[test]
fn rejects_unknown_apid_during_mapping() {
    let cfg = test_config();
    let fixture =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/ccsds_unknown_apid.hex");
    let bytes = std::fs::read(&fixture).expect("fixture must exist");
    let batch =
        decoder_registry::decode_packet_file(&fixture, &bytes, &cfg).expect("decode should run");

    let dictionary = xtce::load_xtce_dictionary(PathBuf::from(&cfg.xtce_path).as_path())
        .expect("xtce dictionary should load");
    let apid_map = mapping::load_apid_map(PathBuf::from(&cfg.apid_map_path).as_path(), &dictionary)
        .expect("apid map should load");

    let (mapped, errors) =
        mapping::map_decoded_packets(&fixture, &batch.packets, &apid_map, &dictionary);
    assert_eq!(mapped.len(), 0);
    assert!(errors.iter().any(|error| error.code == "unknown_apid"));
}

#[test]
fn accepts_packet_with_missing_parameters_and_marks_flag() {
    let cfg = test_config();
    let dictionary = xtce::load_xtce_dictionary(PathBuf::from(&cfg.xtce_path).as_path())
        .expect("xtce dictionary should load");
    let apid_map = mapping::load_apid_map(PathBuf::from(&cfg.apid_map_path).as_path(), &dictionary)
        .expect("apid map should load");

    let short_payload = DecodedPacket {
        timestamp: "2026-02-23T00:00:00Z".to_string(),
        apid: 900,
        seq_count: 1,
        payload_hex: "43E14000".to_string(),
        payload: vec![0x43, 0xE1, 0x40, 0x00],
        quality_flags: quality::PacketQualityFlags::default(),
        uncertainty: quality::PacketUncertainty::default(),
    };

    let source_file = PathBuf::from("missing-params.bin");
    let (mapped, errors) =
        mapping::map_decoded_packets(&source_file, &[short_payload], &apid_map, &dictionary);
    assert_eq!(mapped.len(), 1);
    assert!(errors
        .iter()
        .any(|error| error.code == "missing_parameters"));
    assert_eq!(
        mapped[0].quality_flags["missing_parameters"].as_bool(),
        Some(true)
    );
}

/// Asserts canonical point shape matches backend contract and clean_raw_window (solarWind.speed, solarWind.density, magneticField.z).
#[test]
fn decode_and_map_packets_produces_canonical_shape_for_backend() {
    let cfg = test_config();
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/ccsds_valid.bin");
    let bytes = std::fs::read(&fixture).expect("fixture must exist");
    let resp = decode_and_map_packets(&bytes, decoder_registry::DecoderFormat::CcsdsBin, &cfg)
        .expect("decode_and_map_packets should succeed");
    assert_eq!(resp.decoded_count, 1);
    assert_eq!(resp.mapped_count, 1);
    assert!(!resp.packets.is_empty());
    let packet = &resp.packets[0];
    let point = &packet.canonical_point;
    assert!(point.get("solarWind").and_then(|s| s.get("speed")).is_some());
    assert!(point.get("solarWind").and_then(|s| s.get("density")).is_some());
    assert!(point.get("magneticField").and_then(|m| m.get("z")).is_some());
    let speed = point["solarWind"]["speed"].as_f64().unwrap();
    let density = point["solarWind"]["density"].as_f64().unwrap();
    let bz = point["magneticField"]["z"].as_f64().unwrap();
    assert!(speed.is_finite());
    assert!(density.is_finite());
    assert!(bz.is_finite());
    assert!(packet.quality_flags.get("missing_parameters").is_some());
    assert!(packet.uncertainty.get("speed").is_some());
}
