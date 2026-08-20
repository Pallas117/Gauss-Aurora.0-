use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
struct Manifest {
    schema: String,
    cases: Vec<ReplayCase>,
}

#[derive(Debug, Deserialize)]
struct ReplayCase {
    id: String,
    #[serde(rename = "rustFixture")]
    rust_fixture: Option<String>,
    #[serde(rename = "expectedAggregate")]
    expected_aggregate: String,
    #[serde(rename = "expectedDecision")]
    expected_decision: String,
}

#[test]
fn replay_manifest_is_network_free_and_references_existing_packet_fixtures() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let manifest_path = root.join("services/yamcs-replay/fixtures/gauss-seven-zone-replay.json");
    let raw = std::fs::read_to_string(&manifest_path).expect("replay manifest must exist");
    let manifest: Manifest =
        serde_json::from_str(&raw).expect("replay manifest must be valid JSON");

    assert_eq!(manifest.schema, "gauss-seven-zone-replay-v1");
    assert_eq!(manifest.cases.len(), 8);
    for case in manifest.cases {
        assert!(!case.id.is_empty());
        assert!(matches!(
            case.expected_aggregate.as_str(),
            "nominal" | "degraded" | "unknown" | "blocked"
        ));
        assert!(matches!(
            case.expected_decision.as_str(),
            "screened" | "unknown" | "blocked"
        ));
        if let Some(relative_fixture) = case.rust_fixture {
            assert!(
                root.join(relative_fixture).is_file(),
                "fixture missing for {}",
                case.id
            );
        }
    }
}
