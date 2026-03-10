#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Sensitivity {
    High,
    Low,
    Unknown,
}

#[derive(Debug, Clone)]
pub enum RoutingTarget {
    Local,
    Cloud,
}

#[derive(Debug, Clone)]
/// Normalized analysis artifact produced from one telemetry input file.
/// This is persisted in the in-memory analysis buffer for operator views and summaries.
pub struct TelemetryAnalysis {
    pub timestamp: String,
    pub sensitivity: Sensitivity,
    pub detected_patterns: Vec<String>,
    pub file_name: String,
}

/// Result of routing telemetry to local (DeepSeek) or cloud.
/// When the local engine is DeepSeek, it is treated as the mission operator / decision-maker;
/// `operator_decision` carries its recommendation (e.g. NOMINAL / MONITOR / INITIATE SHIELDING).
#[derive(Debug, Clone)]
pub struct RoutingDecision {
    pub target: RoutingTarget,
    pub reason: String,
    pub anonymized: bool,
    /// Decision text from the local engine (DeepSeek as operator); set when routing to local.
    pub operator_decision: Option<String>,
}
