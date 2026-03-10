use gauss_orchestrator::network_management::{
    default_network_manager, ControlStatus, DtnIslAuditReport, LinkState, LinkType, NetworkManager,
    TransferPlanRequest,
};

fn find_control<'a>(report: &'a DtnIslAuditReport, id: &str) -> &'a ControlStatus {
    &report
        .controls
        .iter()
        .find(|control| control.id == id)
        .expect("control should exist")
        .status
}

#[test]
fn audit_has_required_dtn_and_isl_controls() {
    let manager = default_network_manager();
    let report = manager.audit().expect("audit should succeed");

    assert!(report.isl_links >= 1);
    assert!(report.ground_links >= 1);
    assert_eq!(*find_control(&report, "DTN-ISL-1"), ControlStatus::Pass);
    assert_eq!(*find_control(&report, "DTN-ISL-3"), ControlStatus::Pass);
    assert_eq!(report.fail, 0);
}

#[test]
fn direct_route_selected_for_high_priority_same_segment() {
    let manager = default_network_manager();
    let plan = manager
        .plan_transfer(TransferPlanRequest {
            source: "SAT-A".to_string(),
            destination: "SAT-B".to_string(),
            payload_bytes: 16_000,
            priority: 10,
            max_latency_ms: Some(100),
            requires_encryption: true,
            allow_disruption_tolerant: true,
        })
        .expect("should route");

    assert_eq!(plan.mode, gauss_orchestrator::network_management::RouteMode::Direct);
    assert_eq!(plan.hops.len(), 1);
    assert_eq!(plan.hops[0].link_id, "isl-a-b");
}

#[test]
fn dtn_route_used_when_only_multi_hop_path_exists() {
    let manager = default_network_manager();
    let plan = manager
        .plan_transfer(TransferPlanRequest {
            source: "SAT-A".to_string(),
            destination: "GROUND-KL".to_string(),
            payload_bytes: 128_000,
            priority: 5,
            max_latency_ms: None,
            requires_encryption: true,
            allow_disruption_tolerant: true,
        })
        .expect("should route via dtn");

    assert_eq!(
        plan.mode,
        gauss_orchestrator::network_management::RouteMode::StoreAndForward
    );
    assert_eq!(plan.hops.len(), 2);
}

#[test]
fn no_route_when_dtn_disabled_for_disconnected_path() {
    let manager = default_network_manager();
    let err = manager
        .plan_transfer(TransferPlanRequest {
            source: "SAT-A".to_string(),
            destination: "GROUND-KL".to_string(),
            payload_bytes: 128_000,
            priority: 5,
            max_latency_ms: None,
            requires_encryption: true,
            allow_disruption_tolerant: false,
        })
        .expect_err("route should fail without dtn fallback");

    assert_eq!(err.code, "no_route");
}

#[test]
fn audit_warns_when_qos_is_single_tier() {
    let manager = NetworkManager::default();
    manager
        .upsert_link(LinkState {
            link_id: "isl-1".to_string(),
            from_node: "SAT-1".to_string(),
            to_node: "SAT-2".to_string(),
            link_type: LinkType::Isl,
            bandwidth_mbps: 150.0,
            latency_ms: 50,
            max_payload_bytes: 64_000,
            healthy: true,
            secure: true,
            dtn_enabled: true,
            compression_enabled: true,
            qos_tier: "standard".to_string(),
            updated_at: "".to_string(),
        })
        .expect("link should be accepted");
    manager
        .upsert_link(LinkState {
            link_id: "ground-1".to_string(),
            from_node: "SAT-2".to_string(),
            to_node: "GROUND-1".to_string(),
            link_type: LinkType::Ground,
            bandwidth_mbps: 50.0,
            latency_ms: 120,
            max_payload_bytes: 64_000,
            healthy: true,
            secure: true,
            dtn_enabled: true,
            compression_enabled: true,
            qos_tier: "standard".to_string(),
            updated_at: "".to_string(),
        })
        .expect("link should be accepted");

    let report = manager.audit().expect("audit should succeed");
    assert_eq!(*find_control(&report, "DTN-ISL-4"), ControlStatus::Warn);
}
