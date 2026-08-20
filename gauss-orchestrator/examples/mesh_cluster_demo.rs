//! Offline three-validator harness for the gauss-mesh-v1 contract.
//! This does not open sockets or contact cloud services.

use gauss_orchestrator::mesh_ledger::{MeshCheckpoint, MeshEnvelope, MeshLedger, ValidatorSet};
use std::collections::BTreeMap;

fn main() {
    let validators = ["validator-a", "validator-b", "validator-c"];
    let validator_set = ValidatorSet::new(validators).expect("three-validator set");
    let mut ledger = MeshLedger::new("gauss-genesis-v1", "validator-a");
    let envelope = MeshEnvelope::from_payload(
        "validator-a",
        "device-demo",
        1,
        1_700_000_000_000,
        "telemetry/health",
        br#"{"health":"nominal"}"#,
        "",
        "hybrid-pqc-v1",
        "demo-detached-signature",
    );
    let block = ledger
        .append_event(envelope)
        .expect("append demo event")
        .clone();
    ledger.verify().expect("deterministic replay verification");

    let checkpoint = MeshCheckpoint {
        height: block.height,
        block_hash: block.block_hash,
        signatures: BTreeMap::from([
            ("validator-a".to_string(), "sig-a".to_string()),
            ("validator-b".to_string(), "sig-b".to_string()),
            ("validator-c".to_string(), "sig-c".to_string()),
        ]),
    };
    validator_set
        .validate_checkpoint(&checkpoint)
        .expect("permissioned quorum");

    println!("gauss-mesh-v1 local cluster harness: PASS");
    println!(
        "validators={} quorum={} height={} payloads=off-chain",
        validators.len(),
        validator_set.quorum(),
        checkpoint.height
    );
}
