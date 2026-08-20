//! Bounded, safety-first fleet autoscaling policy.
//!
//! This module is deliberately a pure decision function.  It consumes a
//! normalized health/capacity snapshot produced by the backend data plane and
//! returns a plan; it never sends commands or mutates spacecraft state.  The
//! backend reconciler may apply only the safe device-health actions, while
//! spacecraft actions remain approval-gated at the mission boundary.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResourcePressure {
    Nominal,
    Constrained,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NetworkHealth {
    Nominal,
    Degraded,
    Offline,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum MemoryGrowthTrend {
    NonPositive,
    Positive,
    #[default]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeviceClass {
    Phone,
    Android,
    Linux,
    #[serde(rename = "server-rack")]
    ServerRack,
    Spacecraft,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AutoscaleNode {
    pub id: String,
    pub device_class: DeviceClass,
    pub approved: bool,
    pub healthy: bool,
    pub system_critical: bool,
    pub cache_healthy: Option<bool>,
    pub battery_percent: Option<f64>,
    pub power_source: Option<String>,
    pub load: Option<f64>,
    pub current_jobs: Option<u32>,
    pub store_and_forward: bool,
    pub link_secure: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AutoscaleObservation {
    pub queue_depth: u32,
    pub active_jobs: u32,
    pub desired_capacity: u32,
    pub resource_pressure: ResourcePressure,
    pub network_health: NetworkHealth,
    pub nodes: Vec<AutoscaleNode>,
    pub now_ms: u64,
    pub last_scale_ms: Option<u64>,
    #[serde(default)]
    pub retained_memory_mb: Option<f64>,
    #[serde(default)]
    pub memory_growth_mb: Option<f64>,
    #[serde(default)]
    pub memory_growth_trend: MemoryGrowthTrend,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AutoscalerPolicy {
    pub min_healthy_nodes: u32,
    pub max_nodes: u32,
    pub scale_out_queue_depth: u32,
    pub scale_in_queue_depth: u32,
    pub target_jobs_per_node: u32,
    pub cooldown_ms: u64,
    pub spacecraft_approval_required: bool,
}

impl Default for AutoscalerPolicy {
    fn default() -> Self {
        Self {
            min_healthy_nodes: 1,
            max_nodes: 32,
            scale_out_queue_depth: 2,
            scale_in_queue_depth: 0,
            target_jobs_per_node: 2,
            cooldown_ms: 60_000,
            spacecraft_approval_required: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AutoscaleActionKind {
    Hold,
    ScaleOut,
    ScaleIn,
    HealDevice,
    RequireApproval,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AutoscaleAction {
    pub kind: AutoscaleActionKind,
    pub node_id: Option<String>,
    pub desired_capacity: u32,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AutoscaleDecision {
    pub protocol: String,
    pub desired_capacity: u32,
    pub healthy_capacity: u32,
    pub retained_memory_mb: Option<f64>,
    pub memory_growth_mb: Option<f64>,
    pub memory_growth_trend: MemoryGrowthTrend,
    pub actions: Vec<AutoscaleAction>,
    pub blocked_reason: Option<String>,
}

fn cooldown_elapsed(observation: &AutoscaleObservation, policy: &AutoscalerPolicy) -> bool {
    observation
        .last_scale_ms
        .map(|last| observation.now_ms.saturating_sub(last) >= policy.cooldown_ms)
        .unwrap_or(true)
}

fn safe_healthy_capacity(observation: &AutoscaleObservation) -> u32 {
    observation
        .nodes
        .iter()
        .filter(|node| node.approved && node.healthy && !node.system_critical)
        .count() as u32
}

/// Evaluate one bounded autoscaling cycle.
pub fn evaluate(
    observation: &AutoscaleObservation,
    policy: &AutoscalerPolicy,
) -> AutoscaleDecision {
    let max_nodes = policy.max_nodes.max(policy.min_healthy_nodes.max(1));
    let healthy_capacity = safe_healthy_capacity(observation);
    let mut desired_capacity = observation
        .desired_capacity
        .clamp(policy.min_healthy_nodes, max_nodes);
    let mut actions = Vec::new();
    let mut blocked_reason = None;
    let memory_growth_trend = observation.memory_growth_trend;

    for node in &observation.nodes {
        let spacecraft_requires_approval = node.device_class == DeviceClass::Spacecraft
            && (!node.healthy || node.system_critical || !node.link_secure);
        if !node.approved || spacecraft_requires_approval {
            if spacecraft_requires_approval {
                actions.push(AutoscaleAction {
                    kind: AutoscaleActionKind::RequireApproval,
                    node_id: Some(node.id.clone()),
                    desired_capacity,
                    reason: "Spacecraft health action is approval-gated; preserve commandability and safe mode.".to_string(),
                });
            }
            continue;
        }

        let service_unhealthy = node.system_critical
            || node.cache_healthy == Some(false)
            || !node.healthy
            || (node.device_class == DeviceClass::Spacecraft && !node.link_secure);
        if service_unhealthy {
            actions.push(AutoscaleAction {
                kind: AutoscaleActionKind::HealDevice,
                node_id: Some(node.id.clone()),
                desired_capacity,
                reason: "Approved non-spacecraft node is unhealthy; invoke bounded local health recovery.".to_string(),
            });
        }
    }

    if observation.resource_pressure == ResourcePressure::Critical {
        blocked_reason = Some(
            "local resource pressure is critical; do not scale into the constrained host"
                .to_string(),
        );
    } else if observation.network_health == NetworkHealth::Offline {
        blocked_reason = Some(
            "network is offline; retain current capacity and use store-and-forward".to_string(),
        );
    } else if !cooldown_elapsed(observation, policy) {
        blocked_reason = Some("autoscaling cooldown is active".to_string());
    } else if observation.queue_depth >= policy.scale_out_queue_depth
        || observation.active_jobs > healthy_capacity.saturating_mul(policy.target_jobs_per_node)
        || healthy_capacity < policy.min_healthy_nodes
    {
        if memory_growth_trend != MemoryGrowthTrend::NonPositive {
            blocked_reason = Some(match memory_growth_trend {
                MemoryGrowthTrend::Positive => "retained pipeline memory is growing; refine/evict before scaling out".to_string(),
                MemoryGrowthTrend::Unknown => "memory growth baseline is not established; hold scale-out until two samples exist".to_string(),
                MemoryGrowthTrend::NonPositive => unreachable!(),
            });
        } else {
            let increment = 1;
            let next_capacity = desired_capacity.saturating_add(increment).min(max_nodes);
            if next_capacity > desired_capacity {
                desired_capacity = next_capacity;
                actions.push(AutoscaleAction {
                    kind: AutoscaleActionKind::ScaleOut,
                    node_id: None,
                    desired_capacity,
                    reason: "Queue depth, active jobs, or minimum healthy capacity requires another approved node while retained memory is non-growing.".to_string(),
                });
            } else {
                blocked_reason = Some("maximum fleet capacity is already reached".to_string());
            }
        }
    } else if observation.queue_depth <= policy.scale_in_queue_depth
        && observation.active_jobs == 0
        && healthy_capacity > policy.min_healthy_nodes
    {
        desired_capacity = desired_capacity
            .saturating_sub(1)
            .max(policy.min_healthy_nodes);
        if desired_capacity < observation.desired_capacity {
            actions.push(AutoscaleAction {
                kind: AutoscaleActionKind::ScaleIn,
                node_id: None,
                desired_capacity,
                reason:
                    "Capacity is idle above the protected minimum; retire one non-critical node."
                        .to_string(),
            });
        }
    }

    if actions.is_empty() {
        actions.push(AutoscaleAction {
            kind: AutoscaleActionKind::Hold,
            node_id: None,
            desired_capacity,
            reason: blocked_reason
                .clone()
                .unwrap_or_else(|| "fleet is within bounded policy".to_string()),
        });
    }

    AutoscaleDecision {
        protocol: "gauss-autoscale-v1".to_string(),
        desired_capacity,
        healthy_capacity,
        retained_memory_mb: observation.retained_memory_mb,
        memory_growth_mb: observation.memory_growth_mb,
        memory_growth_trend,
        actions,
        blocked_reason,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: &str, class: DeviceClass, healthy: bool) -> AutoscaleNode {
        AutoscaleNode {
            id: id.to_string(),
            device_class: class,
            approved: true,
            healthy,
            system_critical: !healthy,
            cache_healthy: Some(healthy),
            battery_percent: Some(90.0),
            power_source: Some("ac".to_string()),
            load: Some(0.2),
            current_jobs: Some(0),
            store_and_forward: false,
            link_secure: true,
        }
    }

    #[test]
    fn scales_out_on_queue_but_respects_maximum() {
        let policy = AutoscalerPolicy {
            max_nodes: 2,
            ..AutoscalerPolicy::default()
        };
        let observation = AutoscaleObservation {
            queue_depth: 5,
            active_jobs: 5,
            desired_capacity: 1,
            resource_pressure: ResourcePressure::Nominal,
            network_health: NetworkHealth::Nominal,
            nodes: vec![node("linux-1", DeviceClass::Linux, true)],
            now_ms: 10_000,
            last_scale_ms: None,
            retained_memory_mb: None,
            memory_growth_mb: None,
            memory_growth_trend: MemoryGrowthTrend::NonPositive,
        };
        let decision = evaluate(&observation, &policy);
        assert_eq!(decision.desired_capacity, 2);
        assert!(decision
            .actions
            .iter()
            .any(|a| a.kind == AutoscaleActionKind::ScaleOut));
    }

    #[test]
    fn critical_memory_blocks_scale_out() {
        let observation = AutoscaleObservation {
            queue_depth: 50,
            active_jobs: 50,
            desired_capacity: 1,
            resource_pressure: ResourcePressure::Critical,
            network_health: NetworkHealth::Nominal,
            nodes: vec![node("linux-1", DeviceClass::Linux, true)],
            now_ms: 10_000,
            last_scale_ms: None,
            retained_memory_mb: None,
            memory_growth_mb: None,
            memory_growth_trend: MemoryGrowthTrend::Positive,
        };
        let decision = evaluate(&observation, &AutoscalerPolicy::default());
        assert_eq!(decision.desired_capacity, 1);
        assert!(decision.blocked_reason.is_some());
        assert!(!decision
            .actions
            .iter()
            .any(|a| a.kind == AutoscaleActionKind::ScaleOut));
    }

    #[test]
    fn positive_retained_memory_blocks_scale_out_before_critical_pressure() {
        let observation = AutoscaleObservation {
            queue_depth: 50,
            active_jobs: 50,
            desired_capacity: 1,
            resource_pressure: ResourcePressure::Nominal,
            network_health: NetworkHealth::Nominal,
            nodes: vec![node("linux-1", DeviceClass::Linux, true)],
            now_ms: 10_000,
            last_scale_ms: None,
            retained_memory_mb: Some(900.0),
            memory_growth_mb: Some(12.0),
            memory_growth_trend: MemoryGrowthTrend::Positive,
        };
        let decision = evaluate(&observation, &AutoscalerPolicy::default());
        assert_eq!(decision.desired_capacity, 1);
        assert_eq!(decision.memory_growth_trend, MemoryGrowthTrend::Positive);
        assert!(decision
            .blocked_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("refine/evict")));
        assert!(!decision
            .actions
            .iter()
            .any(|a| a.kind == AutoscaleActionKind::ScaleOut));
    }

    #[test]
    fn spacecraft_recovery_requires_approval() {
        let observation = AutoscaleObservation {
            queue_depth: 0,
            active_jobs: 0,
            desired_capacity: 1,
            resource_pressure: ResourcePressure::Nominal,
            network_health: NetworkHealth::Nominal,
            nodes: vec![node("sc-1", DeviceClass::Spacecraft, false)],
            now_ms: 10_000,
            last_scale_ms: None,
            retained_memory_mb: None,
            memory_growth_mb: None,
            memory_growth_trend: MemoryGrowthTrend::NonPositive,
        };
        let decision = evaluate(&observation, &AutoscalerPolicy::default());
        assert!(decision
            .actions
            .iter()
            .any(|a| a.kind == AutoscaleActionKind::RequireApproval));
        assert!(!decision
            .actions
            .iter()
            .any(|a| a.kind == AutoscaleActionKind::HealDevice));
    }
}
