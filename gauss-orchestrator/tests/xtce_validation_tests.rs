//! Integration tests: validate baseline XTCE and apid-map (Task 4 full alignment).

use gauss_orchestrator::telemetry::xtce;
use std::path::Path;

#[test]
fn baseline_xtce_and_apid_map_validate() {
    let xtce_path = Path::new("config/xtce/baseline.xtce.xml");
    let apid_map_path = Path::new("config/xtce/apid-map.json");
    if !xtce_path.exists() || !apid_map_path.exists() {
        eprintln!(
            "Skip: config files not found (run from gauss-orchestrator dir): {:?} {:?}",
            xtce_path, apid_map_path
        );
        return;
    }
    let result = xtce::validate_xtce_apid_paths(xtce_path, apid_map_path);
    assert!(
        result.is_ok(),
        "XTCE/apid-map validation should pass for baseline: {:?}",
        result.unwrap_err()
    );
}
