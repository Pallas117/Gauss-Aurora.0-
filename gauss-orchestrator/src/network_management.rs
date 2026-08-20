use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, RwLock};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LinkType {
    Isl,
    Ground,
    Relay,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkState {
    pub link_id: String,
    pub from_node: String,
    pub to_node: String,
    pub link_type: LinkType,
    pub bandwidth_mbps: f64,
    pub latency_ms: u32,
    pub max_payload_bytes: usize,
    pub healthy: bool,
    pub secure: bool,
    pub dtn_enabled: bool,
    pub compression_enabled: bool,
    pub qos_tier: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferPlanRequest {
    pub source: String,
    pub destination: String,
    pub payload_bytes: usize,
    pub priority: u8,
    pub max_latency_ms: Option<u32>,
    pub requires_encryption: bool,
    pub allow_disruption_tolerant: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RouteMode {
    Direct,
    StoreAndForward,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteHop {
    pub link_id: String,
    pub from_node: String,
    pub to_node: String,
    pub latency_ms: u32,
    pub bandwidth_mbps: f64,
    pub secure: bool,
    pub dtn_enabled: bool,
    pub max_payload_bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferPlan {
    pub mode: RouteMode,
    pub qos_class: String,
    pub estimated_delivery_ms: u64,
    pub hops: Vec<RouteHop>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ControlStatus {
    Pass,
    Warn,
    Fail,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditControl {
    pub id: String,
    pub title: String,
    pub status: ControlStatus,
    pub details: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DtnIslAuditReport {
    pub generated_at: String,
    pub link_count: usize,
    pub isl_links: usize,
    pub ground_links: usize,
    pub secure_links: usize,
    pub dtn_enabled_links: usize,
    pub qos_profiles: usize,
    pub readiness_score: u8,
    pub pass: usize,
    pub warn: usize,
    pub fail: usize,
    pub controls: Vec<AuditControl>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NetworkError {
    pub code: String,
    pub message: String,
}

impl std::fmt::Display for NetworkError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for NetworkError {}

#[derive(Clone, Default)]
pub struct NetworkManager {
    links: Arc<RwLock<HashMap<String, LinkState>>>,
}

impl NetworkManager {
    pub fn upsert_link(&self, mut link: LinkState) -> Result<LinkState, NetworkError> {
        validate_link(&link)?;
        link.updated_at = now_iso();

        let mut store = self.links.write().map_err(|_| NetworkError {
            code: "store_poisoned".to_string(),
            message: "network manager lock poisoned".to_string(),
        })?;
        store.insert(link.link_id.clone(), link.clone());
        Ok(link)
    }

    pub fn list_links(&self) -> Result<Vec<LinkState>, NetworkError> {
        let store = self.links.read().map_err(|_| NetworkError {
            code: "store_poisoned".to_string(),
            message: "network manager lock poisoned".to_string(),
        })?;
        let mut links: Vec<LinkState> = store.values().cloned().collect();
        links.sort_by(|a, b| a.link_id.cmp(&b.link_id));
        Ok(links)
    }

    pub fn plan_transfer(&self, req: TransferPlanRequest) -> Result<TransferPlan, NetworkError> {
        if req.source.trim().is_empty() || req.destination.trim().is_empty() {
            return Err(NetworkError {
                code: "invalid_route_request".to_string(),
                message: "source and destination are required".to_string(),
            });
        }
        if req.source == req.destination {
            return Err(NetworkError {
                code: "invalid_route_request".to_string(),
                message: "source and destination must differ".to_string(),
            });
        }
        if req.payload_bytes == 0 {
            return Err(NetworkError {
                code: "invalid_payload".to_string(),
                message: "payload_bytes must be > 0".to_string(),
            });
        }

        let links = self.list_links()?;
        let mut direct_candidates = links
            .iter()
            .filter_map(|link| oriented_hop(link, &req.source, &req.destination))
            .filter(|hop| {
                hop_usable(
                    hop,
                    req.payload_bytes,
                    req.requires_encryption,
                    req.max_latency_ms,
                )
            })
            .collect::<Vec<_>>();

        order_candidates(&mut direct_candidates, req.priority);

        if let Some(best) = direct_candidates.into_iter().next() {
            let qos = qos_class(req.priority);
            return Ok(TransferPlan {
                mode: RouteMode::Direct,
                qos_class: qos.to_string(),
                estimated_delivery_ms: u64::from(best.latency_ms),
                hops: vec![best],
                warnings: vec![],
            });
        }

        if !req.allow_disruption_tolerant {
            return Err(NetworkError {
                code: "no_route".to_string(),
                message: "no direct route is available and DTN fallback is disabled".to_string(),
            });
        }

        let mut staged = Vec::new();
        for first in links
            .iter()
            .filter_map(|link| oriented_hop_from(link, &req.source))
            .filter(|hop| hop.dtn_enabled)
            .filter(|hop| hop_usable(hop, req.payload_bytes, req.requires_encryption, None))
        {
            for second in links
                .iter()
                .filter_map(|link| oriented_hop_to(link, &req.destination))
                .filter(|hop| hop.from_node == first.to_node)
                .filter(|hop| hop.dtn_enabled)
                .filter(|hop| hop_usable(hop, req.payload_bytes, req.requires_encryption, None))
            {
                let total_latency = u64::from(first.latency_ms) + u64::from(second.latency_ms);
                if let Some(max_latency) = req.max_latency_ms {
                    if total_latency > u64::from(max_latency) {
                        continue;
                    }
                }
                staged.push((first.clone(), second.clone(), total_latency));
            }
        }

        staged.sort_by(|a, b| {
            let a_bw = a.0.bandwidth_mbps.min(a.1.bandwidth_mbps);
            let b_bw = b.0.bandwidth_mbps.min(b.1.bandwidth_mbps);
            a.2.cmp(&b.2).then_with(|| b_bw.total_cmp(&a_bw))
        });

        if let Some((first, second, total_latency)) = staged.into_iter().next() {
            let qos = qos_class(req.priority);
            let queue_penalty_ms = match qos {
                "critical" => 1_500_u64,
                "standard" => 4_500_u64,
                _ => 12_000_u64,
            };
            return Ok(TransferPlan {
                mode: RouteMode::StoreAndForward,
                qos_class: qos.to_string(),
                estimated_delivery_ms: total_latency + queue_penalty_ms,
                hops: vec![first, second],
                warnings: vec![
                    "Direct link unavailable; using DTN store-and-forward path.".to_string()
                ],
            });
        }

        Err(NetworkError {
            code: "no_route".to_string(),
            message: "no DTN-capable route found for source/destination pair".to_string(),
        })
    }

    pub fn audit(&self) -> Result<DtnIslAuditReport, NetworkError> {
        let links = self.list_links()?;
        let link_count = links.len();
        let isl_links = links
            .iter()
            .filter(|link| link.link_type == LinkType::Isl)
            .count();
        let ground_links = links
            .iter()
            .filter(|link| link.link_type == LinkType::Ground)
            .count();
        let secure_links = links.iter().filter(|link| link.secure).count();
        let dtn_enabled_links = links.iter().filter(|link| link.dtn_enabled).count();
        let qos_profiles = links
            .iter()
            .map(|link| link.qos_tier.trim().to_lowercase())
            .filter(|value| !value.is_empty())
            .collect::<HashSet<_>>()
            .len();
        let bad_bandwidth = links
            .iter()
            .any(|link| link.bandwidth_mbps <= 0.0 || link.max_payload_bytes == 0);
        let has_store_and_forward_path = has_store_forward_path(&links);

        let mut controls = Vec::new();
        controls.push(AuditControl {
            id: "DTN-ISL-1".to_string(),
            title: "Inter-satellite link inventory".to_string(),
            status: if isl_links > 0 {
                ControlStatus::Pass
            } else {
                ControlStatus::Fail
            },
            details: if isl_links > 0 {
                format!("{} ISL link(s) available.", isl_links)
            } else {
                "No ISL links configured.".to_string()
            },
        });
        controls.push(AuditControl {
            id: "DTN-ISL-2".to_string(),
            title: "Ground/downlink path inventory".to_string(),
            status: if ground_links > 0 {
                ControlStatus::Pass
            } else {
                ControlStatus::Fail
            },
            details: if ground_links > 0 {
                format!("{} ground link(s) available.", ground_links)
            } else {
                "No ground links configured.".to_string()
            },
        });
        controls.push(AuditControl {
            id: "DTN-ISL-3".to_string(),
            title: "DTN store-and-forward capability".to_string(),
            status: if dtn_enabled_links > 0 {
                ControlStatus::Pass
            } else {
                ControlStatus::Fail
            },
            details: if dtn_enabled_links > 0 {
                format!("{} link(s) support DTN.", dtn_enabled_links)
            } else {
                "No links have DTN enabled.".to_string()
            },
        });
        controls.push(AuditControl {
            id: "DTN-ISL-4".to_string(),
            title: "QoS profile diversity".to_string(),
            status: if qos_profiles >= 2 {
                ControlStatus::Pass
            } else if qos_profiles == 1 {
                ControlStatus::Warn
            } else {
                ControlStatus::Fail
            },
            details: if qos_profiles >= 2 {
                format!("{} QoS profile tiers configured.", qos_profiles)
            } else if qos_profiles == 1 {
                "Only one QoS tier configured; prioritization is limited.".to_string()
            } else {
                "No QoS tier data found on links.".to_string()
            },
        });
        controls.push(AuditControl {
            id: "DTN-ISL-5".to_string(),
            title: "Bandwidth and payload policy".to_string(),
            status: if !bad_bandwidth {
                ControlStatus::Pass
            } else {
                ControlStatus::Fail
            },
            details: if !bad_bandwidth {
                "All links enforce positive bandwidth and payload ceilings.".to_string()
            } else {
                "One or more links have invalid bandwidth/max_payload constraints.".to_string()
            },
        });
        controls.push(AuditControl {
            id: "DTN-ISL-6".to_string(),
            title: "Disruption-tolerant route continuity".to_string(),
            status: if has_store_and_forward_path {
                ControlStatus::Pass
            } else {
                ControlStatus::Warn
            },
            details: if has_store_and_forward_path {
                "At least one multi-hop DTN path exists.".to_string()
            } else {
                "No validated multi-hop DTN path detected.".to_string()
            },
        });
        controls.push(AuditControl {
            id: "DTN-ISL-7".to_string(),
            title: "Link security posture".to_string(),
            status: if link_count > 0 && secure_links == link_count {
                ControlStatus::Pass
            } else if secure_links > 0 {
                ControlStatus::Warn
            } else {
                ControlStatus::Fail
            },
            details: if link_count > 0 && secure_links == link_count {
                "All configured links are marked secure.".to_string()
            } else if secure_links > 0 {
                format!(
                    "{} out of {} links are secure; review non-secure routes.",
                    secure_links, link_count
                )
            } else {
                "No secure links available.".to_string()
            },
        });

        let pass = controls
            .iter()
            .filter(|control| control.status == ControlStatus::Pass)
            .count();
        let warn = controls
            .iter()
            .filter(|control| control.status == ControlStatus::Warn)
            .count();
        let fail = controls
            .iter()
            .filter(|control| control.status == ControlStatus::Fail)
            .count();

        let total = controls.len() as f64;
        let score = if total > 0.0 {
            ((pass as f64 * 1.0 + warn as f64 * 0.6) / total * 100.0).round()
        } else {
            0.0
        };

        Ok(DtnIslAuditReport {
            generated_at: now_iso(),
            link_count,
            isl_links,
            ground_links,
            secure_links,
            dtn_enabled_links,
            qos_profiles,
            readiness_score: score.clamp(0.0, 100.0) as u8,
            pass,
            warn,
            fail,
            controls,
        })
    }
}

pub fn default_network_manager() -> NetworkManager {
    let manager = NetworkManager::default();
    let baseline = vec![
        LinkState {
            link_id: "isl-a-b".to_string(),
            from_node: "SAT-A".to_string(),
            to_node: "SAT-B".to_string(),
            link_type: LinkType::Isl,
            bandwidth_mbps: 350.0,
            latency_ms: 45,
            max_payload_bytes: 512_000,
            healthy: true,
            secure: true,
            dtn_enabled: true,
            compression_enabled: true,
            qos_tier: "critical".to_string(),
            updated_at: now_iso(),
        },
        LinkState {
            link_id: "isl-b-c".to_string(),
            from_node: "SAT-B".to_string(),
            to_node: "SAT-C".to_string(),
            link_type: LinkType::Isl,
            bandwidth_mbps: 220.0,
            latency_ms: 52,
            max_payload_bytes: 512_000,
            healthy: true,
            secure: true,
            dtn_enabled: true,
            compression_enabled: true,
            qos_tier: "standard".to_string(),
            updated_at: now_iso(),
        },
        LinkState {
            link_id: "downlink-b-kl".to_string(),
            from_node: "SAT-B".to_string(),
            to_node: "GROUND-KL".to_string(),
            link_type: LinkType::Ground,
            bandwidth_mbps: 80.0,
            latency_ms: 120,
            max_payload_bytes: 256_000,
            healthy: true,
            secure: true,
            dtn_enabled: true,
            compression_enabled: true,
            qos_tier: "bulk".to_string(),
            updated_at: now_iso(),
        },
    ];

    for link in baseline {
        let _ = manager.upsert_link(link);
    }
    manager
}

fn validate_link(link: &LinkState) -> Result<(), NetworkError> {
    if link.link_id.trim().is_empty() {
        return Err(NetworkError {
            code: "invalid_link".to_string(),
            message: "link_id is required".to_string(),
        });
    }
    if link.from_node.trim().is_empty() || link.to_node.trim().is_empty() {
        return Err(NetworkError {
            code: "invalid_link".to_string(),
            message: "from_node and to_node are required".to_string(),
        });
    }
    if link.from_node == link.to_node {
        return Err(NetworkError {
            code: "invalid_link".to_string(),
            message: "from_node and to_node must differ".to_string(),
        });
    }
    if !link.bandwidth_mbps.is_finite() || link.bandwidth_mbps <= 0.0 {
        return Err(NetworkError {
            code: "invalid_bandwidth".to_string(),
            message: "bandwidth_mbps must be > 0".to_string(),
        });
    }
    if link.max_payload_bytes == 0 {
        return Err(NetworkError {
            code: "invalid_payload_limit".to_string(),
            message: "max_payload_bytes must be > 0".to_string(),
        });
    }
    Ok(())
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

fn qos_class(priority: u8) -> &'static str {
    if priority >= 8 {
        "critical"
    } else if priority >= 4 {
        "standard"
    } else {
        "bulk"
    }
}

fn hop_usable(
    hop: &RouteHop,
    payload_bytes: usize,
    requires_encryption: bool,
    max_latency_ms: Option<u32>,
) -> bool {
    if requires_encryption && !hop.secure {
        return false;
    }
    if payload_bytes == 0 || payload_bytes > hop.max_payload_bytes {
        return false;
    }
    if let Some(limit) = max_latency_ms {
        if hop.latency_ms > limit {
            return false;
        }
    }
    true
}

fn oriented_hop(link: &LinkState, source: &str, destination: &str) -> Option<RouteHop> {
    if !link.healthy {
        return None;
    }
    if link.from_node == source && link.to_node == destination {
        return Some(to_hop(link, source, destination));
    }
    if link.from_node == destination && link.to_node == source {
        return Some(to_hop(link, source, destination));
    }
    None
}

fn oriented_hop_from(link: &LinkState, source: &str) -> Option<RouteHop> {
    if !link.healthy {
        return None;
    }
    if link.from_node == source {
        return Some(to_hop(link, &link.from_node, &link.to_node));
    }
    if link.to_node == source {
        return Some(to_hop(link, &link.to_node, &link.from_node));
    }
    None
}

fn oriented_hop_to(link: &LinkState, destination: &str) -> Option<RouteHop> {
    if !link.healthy {
        return None;
    }
    if link.to_node == destination {
        return Some(to_hop(link, &link.from_node, &link.to_node));
    }
    if link.from_node == destination {
        return Some(to_hop(link, &link.to_node, &link.from_node));
    }
    None
}

fn to_hop(link: &LinkState, from_node: &str, to_node: &str) -> RouteHop {
    RouteHop {
        link_id: link.link_id.clone(),
        from_node: from_node.to_string(),
        to_node: to_node.to_string(),
        latency_ms: link.latency_ms,
        bandwidth_mbps: link.bandwidth_mbps,
        secure: link.secure,
        dtn_enabled: link.dtn_enabled,
        max_payload_bytes: link.max_payload_bytes,
    }
}

fn order_candidates(candidates: &mut [RouteHop], priority: u8) {
    if priority >= 8 {
        candidates.sort_by(|a, b| {
            a.latency_ms
                .cmp(&b.latency_ms)
                .then_with(|| b.bandwidth_mbps.total_cmp(&a.bandwidth_mbps))
        });
        return;
    }
    candidates.sort_by(|a, b| {
        b.bandwidth_mbps
            .total_cmp(&a.bandwidth_mbps)
            .then_with(|| a.latency_ms.cmp(&b.latency_ms))
    });
}

fn has_store_forward_path(links: &[LinkState]) -> bool {
    for first in links.iter().filter(|link| link.healthy && link.dtn_enabled) {
        for second in links.iter().filter(|link| link.healthy && link.dtn_enabled) {
            if first.link_id == second.link_id {
                continue;
            }
            if first.to_node == second.from_node || first.from_node == second.to_node {
                return true;
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_topology_passes_audit() {
        let manager = default_network_manager();
        let report = manager.audit().expect("audit should succeed");
        assert!(report.link_count >= 3);
        assert!(report.isl_links >= 1);
        assert!(report.ground_links >= 1);
        assert_eq!(report.fail, 0);
        assert!(report.readiness_score >= 80);
    }

    #[test]
    fn prefers_direct_route_when_available() {
        let manager = default_network_manager();
        let plan = manager
            .plan_transfer(TransferPlanRequest {
                source: "SAT-A".to_string(),
                destination: "SAT-B".to_string(),
                payload_bytes: 128_000,
                priority: 9,
                max_latency_ms: Some(100),
                requires_encryption: true,
                allow_disruption_tolerant: true,
            })
            .expect("direct route should be found");

        assert_eq!(plan.mode, RouteMode::Direct);
        assert_eq!(plan.hops.len(), 1);
        assert_eq!(plan.hops[0].from_node, "SAT-A");
        assert_eq!(plan.hops[0].to_node, "SAT-B");
    }

    #[test]
    fn falls_back_to_store_and_forward_when_direct_absent() {
        let manager = default_network_manager();
        let plan = manager
            .plan_transfer(TransferPlanRequest {
                source: "SAT-A".to_string(),
                destination: "GROUND-KL".to_string(),
                payload_bytes: 128_000,
                priority: 6,
                max_latency_ms: None,
                requires_encryption: true,
                allow_disruption_tolerant: true,
            })
            .expect("dtn route should be found");

        assert_eq!(plan.mode, RouteMode::StoreAndForward);
        assert_eq!(plan.hops.len(), 2);
        assert!(!plan.warnings.is_empty());
    }

    #[test]
    fn rejects_payload_that_exceeds_link_policy() {
        let manager = default_network_manager();
        let result = manager.plan_transfer(TransferPlanRequest {
            source: "SAT-A".to_string(),
            destination: "SAT-B".to_string(),
            payload_bytes: 900_000,
            priority: 9,
            max_latency_ms: Some(200),
            requires_encryption: true,
            allow_disruption_tolerant: true,
        });

        assert!(result.is_err());
        assert_eq!(result.err().unwrap().code, "no_route");
    }

    #[test]
    fn audit_flags_missing_dtn_support() {
        let manager = NetworkManager::default();
        manager
            .upsert_link(LinkState {
                link_id: "isl-x-y".to_string(),
                from_node: "SAT-X".to_string(),
                to_node: "SAT-Y".to_string(),
                link_type: LinkType::Isl,
                bandwidth_mbps: 100.0,
                latency_ms: 60,
                max_payload_bytes: 128_000,
                healthy: true,
                secure: true,
                dtn_enabled: false,
                compression_enabled: false,
                qos_tier: "standard".to_string(),
                updated_at: now_iso(),
            })
            .expect("link should be accepted");

        let report = manager.audit().expect("audit should succeed");
        let dtn_control = report
            .controls
            .iter()
            .find(|control| control.id == "DTN-ISL-3")
            .expect("DTN control should exist");
        assert_eq!(dtn_control.status, ControlStatus::Fail);
    }
}
