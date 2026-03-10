/// Multi-Agent Code Analysis Integration
/// Routes discovered issues to AI agents for autonomous analysis and fixing
///
/// Uses the multi-agent orchestration system to:
/// - Analyze issues from different perspectives
/// - Generate consensus on best fixes
/// - Validate proposed changes
/// - Report findings to Telegram
/// - Emit work-queue artifact for Cursor subagent coordination
use crate::code_indexer::{CodeIssue, IssueSeverity, IssueType};
use crate::multi_agent::{MultiAgentOrchestrator, TaskType};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// Analysis result from multi-agent orchestration
#[derive(Debug, Clone)]
pub struct MultiAgentAnalysis {
    pub issue_id: String,
    pub issue_type: IssueType,
    pub severity: IssueSeverity,
    pub agent_perspectives: Vec<AgentPerspective>,
    pub consensus: String,
    pub recommended_action: RecommendedAction,
    pub confidence: f64,
}

/// A single agent's perspective on an issue
#[derive(Debug, Clone)]
pub struct AgentPerspective {
    pub agent_name: String,
    pub analysis: String,
    pub suggested_approach: String,
    pub risk_level: RiskLevel,
}

/// Risk level assessment
#[derive(Debug, Clone, PartialEq)]
pub enum RiskLevel {
    Low,
    Medium,
    High,
}

impl std::fmt::Display for RiskLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RiskLevel::Low => write!(f, "🟢 Low"),
            RiskLevel::Medium => write!(f, "🟡 Medium"),
            RiskLevel::High => write!(f, "🔴 High"),
        }
    }
}

/// Recommended action after analysis
#[derive(Debug, Clone, PartialEq)]
pub enum RecommendedAction {
    AutoFix,
    RequireReview,
    RequireManualFix,
    Monitor,
    Defer,
}

impl std::fmt::Display for RecommendedAction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RecommendedAction::AutoFix => write!(f, "✅ Auto-fix"),
            RecommendedAction::RequireReview => write!(f, "👀 Require Review"),
            RecommendedAction::RequireManualFix => write!(f, "🔨 Manual Fix"),
            RecommendedAction::Monitor => write!(f, "📊 Monitor"),
            RecommendedAction::Defer => write!(f, "⏸️ Defer"),
        }
    }
}

/// Work-queue item for Cursor subagent coordination (agents-project-manager).
/// Written to reports/orchestrator/work-queue.json so the project-manager can delegate.
/// `estimated_minutes` is conservative (high end) for scheduling and roadmap planning.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkQueueItem {
    pub id: String,
    pub title: String,
    pub severity: String,
    pub priority: u8,
    /// Conservative development time estimate in minutes (high end of band) for scheduling.
    #[serde(rename = "estimated_minutes")]
    pub estimated_minutes: u32,
    #[serde(rename = "recommended_agent")]
    pub recommended_agent: String,
    #[serde(rename = "recommended_actions")]
    pub recommended_actions: Vec<String>,
    pub file: String,
    pub line: usize,
    pub consensus: String,
    #[serde(rename = "recommended_action")]
    pub recommended_action: String,
    pub confidence: f64,
    #[serde(rename = "issue_type")]
    pub issue_type: String,
}

/// Full work queue with timestamp; overwritten on each orchestrator run.

/// Includes power-safety and scheduling policy for high-value devices (stakeholder demo phase).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkQueue {
    pub timestamp: String,
    /// Sum of all items' estimated_minutes; use for blocking dev time and roadmap planning.
    #[serde(rename = "total_estimated_minutes")]
    pub total_estimated_minutes: u32,
    /// Never run heavy work when device battery is below this (safety for laptops/satellite-like devices).
    #[serde(rename = "min_safe_battery_percent")]
    pub min_safe_battery_percent: u8,
    /// Extra minutes to add to total_estimated_minutes for reserved block (meetings, context-switch). High end.
    #[serde(rename = "scheduling_buffer_minutes")]
    pub scheduling_buffer_minutes: u32,
    pub items: Vec<WorkQueueItem>,
}

/// Conservative development time estimate (minutes) by issue type and severity.
/// High end of band so you can under-promise and buffer for client meetings.
fn estimated_minutes_conservative(issue_type: &IssueType, severity: &IssueSeverity) -> u32 {
    let base = match issue_type {
        IssueType::SecurityConcern | IssueType::ConfigViolation => 60,
        IssueType::MissingErrorHandling | IssueType::TypeMismatch | IssueType::PerformanceIssue => 45,
        IssueType::UnusedImport | IssueType::NamingViolation => 25,
        IssueType::DocumentationMissing | IssueType::UntestablePath => 40,
    };
    match severity {
        IssueSeverity::Critical => (base + 15).min(90),
        IssueSeverity::Error => (base + 10).min(75),
        _ => base,
    }
}

/// Map issue type and recommended action to Cursor subagent tag.
fn issue_type_to_recommended_agent(
    issue_type: &IssueType,
    recommended_action: &RecommendedAction,
) -> &'static str {
    match issue_type {
        IssueType::SecurityConcern => "cyber-devops",
        IssueType::ConfigViolation => "cyber-devops",
        IssueType::UnusedImport | IssueType::NamingViolation => "shell",
        IssueType::PerformanceIssue | IssueType::UntestablePath | IssueType::TypeMismatch => {
            "explore"
        }
        IssueType::DocumentationMissing => "explore",
        IssueType::MissingErrorHandling => {
            if matches!(recommended_action, RecommendedAction::RequireReview) {
                "ada-health"
            } else {
                "explore"
            }
        }
    }
}

/// Backend lint issues JSON shape (from backend/scripts/scan-lint-issues.ts).
#[derive(Deserialize)]
struct BackendLintReport {
    issues: Vec<BackendLintIssue>,
}

#[derive(Deserialize)]
struct BackendLintIssue {
    file: String,
    line: u64,
    message: String,
    severity: String,
}

/// Load backend lint issues from JSON and convert to work queue items.
/// Path is typically reports/progress/backend-lint-issues.json (workspace-relative).
pub fn load_backend_lint_items(json_path: &Path) -> Vec<WorkQueueItem> {
    let content = match fs::read_to_string(json_path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let report: BackendLintReport = match serde_json::from_str(&content) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };
    report
        .issues
        .into_iter()
        .map(|i| {
            let severity = i.severity.to_lowercase();
            let priority = if severity == "error" { 3u8 } else { 2u8 };
            let id = format!(
                "backend-lint-{}:{}",
                i.file.replace('/', "-").replace('\\', "-"),
                i.line
            );
            WorkQueueItem {
                id: id.clone(),
                title: i.message,
                severity: if severity == "error" {
                    "error".to_string()
                } else {
                    "warning".to_string()
                },
                priority,
                estimated_minutes: 10,
                recommended_agent: "backend".to_string(),
                recommended_actions: vec!["Fix TypeScript/lint".to_string()],
                file: i.file,
                line: i.line as usize,
                consensus: String::new(),
                recommended_action: "RequireReview".to_string(),
                confidence: 0.8,
                issue_type: "lint".to_string(),
            }
        })
        .collect()
}

/// Merge backend lint items into the work queue and recompute totals.
pub fn merge_backend_lint_into_queue(queue: &mut WorkQueue, json_path: &Path) {
    let items = load_backend_lint_items(json_path);
    if items.is_empty() {
        return;
    }
    queue.items.extend(items);
    queue.total_estimated_minutes = queue.items.iter().map(|i| i.estimated_minutes).sum();
    queue.scheduling_buffer_minutes =
        (queue.total_estimated_minutes / 10).clamp(10u32, 60u32);
}

#[derive(Deserialize)]
struct DirectiveUncompletedReport {
    uncompleted: Vec<DirectiveUncompletedItem>,
}

#[derive(Deserialize)]
struct DirectiveUncompletedItem {
    section: String,
    item: String,
    reason: String,
}

/// Load directive uncompleted items and convert to work queue items (steps, not file-line fixes).
pub fn load_directive_uncompleted_items(json_path: &Path) -> Vec<WorkQueueItem> {
    let content = match fs::read_to_string(json_path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let report: DirectiveUncompletedReport = match serde_json::from_str(&content) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };
    report
        .uncompleted
        .into_iter()
        .map(|i| {
            let id = format!("directive-{}", i.section.replace('.', "-"));
            WorkQueueItem {
                id: id.clone(),
                title: format!("{} — {}", i.item, i.reason),
                severity: "high".to_string(),
                priority: 3,
                estimated_minutes: 15,
                recommended_agent: "directive".to_string(),
                recommended_actions: vec!["Complete directive checklist item".to_string()],
                file: String::new(),
                line: 0,
                consensus: String::new(),
                recommended_action: "RequireReview".to_string(),
                confidence: 0.9,
                issue_type: "directive".to_string(),
            }
        })
        .collect()
}

/// Merge directive uncompleted items into the work queue and recompute totals.
pub fn merge_directive_uncompleted_into_queue(queue: &mut WorkQueue, json_path: &Path) {
    let items = load_directive_uncompleted_items(json_path);
    if items.is_empty() {
        return;
    }
    queue.items.extend(items);
    queue.total_estimated_minutes = queue.items.iter().map(|i| i.estimated_minutes).sum();
    queue.scheduling_buffer_minutes =
        (queue.total_estimated_minutes / 10).clamp(10u32, 60u32);
}

/// Build work queue from analyzed issues and analyses (match by issue_id).
pub fn build_work_queue(
    issues: &[CodeIssue],
    analyses: &[MultiAgentAnalysis],
) -> WorkQueue {
    let timestamp = chrono::Utc::now().to_rfc3339();
    let mut items = Vec::with_capacity(analyses.len());

    for analysis in analyses {
        let issue = match issues.iter().find(|i| i.id == analysis.issue_id) {
            Some(issue) => issue,
            None => continue,
        };

        let recommended_agent =
            issue_type_to_recommended_agent(&analysis.issue_type, &analysis.recommended_action)
                .to_string();

        let mut recommended_actions = Vec::with_capacity(3);
        let consensus_first = analysis.consensus.lines().next().unwrap_or("").trim();
        if !consensus_first.is_empty() {
            recommended_actions.push(consensus_first.to_string());
        }
        for p in analysis.agent_perspectives.iter().take(2) {
            let approach = p.suggested_approach.trim();
            if !approach.is_empty() && !recommended_actions.contains(&approach.to_string()) {
                recommended_actions.push(approach.to_string());
            }
        }
        if recommended_actions.is_empty() {
            recommended_actions.push(analysis.recommended_action.to_string());
        }

        let priority = match analysis.severity {
            IssueSeverity::Critical => 4,
            IssueSeverity::Error => 3,
            IssueSeverity::Warning => 2,
            IssueSeverity::Info => 1,
        };

        let estimated_minutes =
            estimated_minutes_conservative(&analysis.issue_type, &analysis.severity);

        items.push(WorkQueueItem {
            id: analysis.issue_id.clone(),
            title: issue
                .description
                .lines()
                .next()
                .unwrap_or(&analysis.issue_id)
                .trim()
                .to_string(),
            severity: severity_to_canonical(&analysis.severity).to_string(),
            priority,
            estimated_minutes,
            recommended_agent,
            recommended_actions,
            file: issue.file.display().to_string(),
            line: issue.line_number,
            consensus: analysis.consensus.clone(),
            recommended_action: format!("{}", analysis.recommended_action),
            confidence: analysis.confidence,
            issue_type: format!("{}", analysis.issue_type),
        });
    }

    let total_estimated_minutes = items.iter().map(|i| i.estimated_minutes).sum::<u32>();
    // Power-safety: never run heavy work below 25% (devices as high-value assets; stakeholder demo).
    let min_safe_battery_percent = 25u8;
    // Scheduling buffer: 10% of total, clamped 10–60 min so reserved block = total + buffer.
    let scheduling_buffer_minutes: u32 =
        (total_estimated_minutes / 10).clamp(10u32, 60u32);

    WorkQueue {
        timestamp,
        total_estimated_minutes,
        min_safe_battery_percent,
        scheduling_buffer_minutes,
        items,
    }
}

fn severity_to_canonical(severity: &IssueSeverity) -> &'static str {
    match severity {
        IssueSeverity::Critical => "critical",
        IssueSeverity::Error => "error",
        IssueSeverity::Warning => "warning",
        IssueSeverity::Info => "info",
    }
}

/// Path for the issues JSON companion to a work queue (e.g. work-queue.json -> work-queue-issues.json).
pub fn work_queue_issues_path(work_queue_path: &str) -> String {
    work_queue_path
        .strip_suffix(".json")
        .map(|s| format!("{}-issues.json", s))
        .unwrap_or_else(|| format!("{}-issues.json", work_queue_path))
}

/// Write code issues to JSON path for the patch batch loop (creates parent dir if needed).
pub fn write_issues(issues: &[CodeIssue], json_path: &str) -> Result<(), String> {
    let path = Path::new(json_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create dir {}: {}", parent.display(), e))?;
    }
    let json_str = serde_json::to_string_pretty(issues).map_err(|e| e.to_string())?;
    fs::write(path, json_str).map_err(|e| format!("write {}: {}", path.display(), e))?;
    Ok(())
}

/// Load code issues from JSON path; returns empty vec if file missing or invalid.
pub fn load_issues(json_path: &str) -> Vec<CodeIssue> {
    let path = Path::new(json_path);
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    serde_json::from_str(&content).unwrap_or_else(|_| Vec::new())
}

/// Write work queue to JSON path and optional Markdown; creates parent dir if needed.
pub fn write_work_queue(queue: &WorkQueue, json_path: &str) -> Result<(), String> {
    let path = Path::new(json_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create dir {}: {}", parent.display(), e))?;
    }

    let json_str = serde_json::to_string_pretty(queue).map_err(|e| e.to_string())?;
    fs::write(path, json_str).map_err(|e| format!("write {}: {}", path.display(), e))?;

    let total_h = queue.total_estimated_minutes / 60;
    let total_m = queue.total_estimated_minutes % 60;
    let total_est_line = if total_h > 0 {
        format!("{} min ({}h {}m)", queue.total_estimated_minutes, total_h, total_m)
    } else {
        format!("{} min", queue.total_estimated_minutes)
    };
    let reserved_min = queue.total_estimated_minutes + queue.scheduling_buffer_minutes;
    let reserved_h = reserved_min / 60;
    let reserved_m = reserved_min % 60;
    let reserved_line = if reserved_h > 0 {
        format!("{} min ({}h {}m) = total + {} min buffer", reserved_min, reserved_h, reserved_m, queue.scheduling_buffer_minutes)
    } else {
        format!("{} min (total + {} min buffer)", reserved_min, queue.scheduling_buffer_minutes)
    };

    let md_path = path.with_extension("md");
    let md_content = format!(
        "# Orchestrator Work Queue\n\nGenerated: {}\n\nTotal items: {}\n\n**Total estimated (conservative):** {}\n\n**Reserved block (with buffer):** {} — *Never run heavy work below {}% battery (devices = high-value assets).*\n\n## Items\n\n{}",
        queue.timestamp,
        queue.items.len(),
        total_est_line,
        reserved_line,
        queue.min_safe_battery_percent,
        queue
            .items
            .iter()
            .enumerate()
            .map(|(i, it)| format!(
                "### {}. {} [{}] — Est. {} min\n- **File:** {} (line {})\n- **Agent:** {}\n- **Actions:** {}\n- **Consensus:** {}",
                i + 1,
                it.title,
                it.severity,
                it.estimated_minutes,
                it.file,
                it.line,
                it.recommended_agent,
                it.recommended_actions.join("; "),
                it.consensus.lines().next().unwrap_or("").trim()
            ))
            .collect::<Vec<_>>()
            .join("\n\n")
    );
    fs::write(&md_path, md_content)
        .map_err(|e| format!("write {}: {}", md_path.display(), e))?;

    Ok(())
}

pub struct CodeAnalysisOrchestrator {
    multi_agent: MultiAgentOrchestrator,
}

impl CodeAnalysisOrchestrator {
    /// Create new orchestrator
    pub fn new(multi_agent: MultiAgentOrchestrator) -> Self {
        Self { multi_agent }
    }

    /// Analyze a single issue using multi-agent system
    pub async fn analyze_issue(&self, issue: &CodeIssue) -> Result<MultiAgentAnalysis, String> {
        println!(
            "[code-analysis] 🧠 Multi-agent analysis for: {} ({}:{})",
            issue.id,
            issue.file.display(),
            issue.line_number
        );

        // Route to appropriate task type based on issue type
        let task_type = self.issue_type_to_task(issue);

        // Create analysis prompt
        let prompt = self.create_analysis_prompt(issue);

        // Get multi-agent result
        let ma_result = self
            .multi_agent
            .route_by_task(task_type, &prompt)
            .await
            .map_err(|e| format!("Multi-agent analysis failed: {}", e))?;

        // Extract agent perspectives
        let perspectives: Vec<AgentPerspective> = ma_result
            .agent_results
            .iter()
            .enumerate()
            .map(|(_i, result)| AgentPerspective {
                agent_name: format!("{:?}", result.model),
                analysis: result.response.clone(),
                suggested_approach: self.extract_approach(&result.response),
                risk_level: if result.confidence > 0.85 {
                    RiskLevel::Low
                } else if result.confidence > 0.6 {
                    RiskLevel::Medium
                } else {
                    RiskLevel::High
                },
            })
            .collect();

        // Determine recommended action
        let recommended_action = self.determine_action(issue, ma_result.overall_confidence.into());

        println!(
            "[code-analysis] ✅ Analysis complete: {} (confidence: {:.0}%)",
            issue.id,
            ma_result.overall_confidence * 100.0
        );

        Ok(MultiAgentAnalysis {
            issue_id: issue.id.clone(),
            issue_type: issue.issue_type.clone(),
            severity: issue.severity,
            agent_perspectives: perspectives,
            consensus: ma_result.consensus,
            recommended_action,
            confidence: ma_result.overall_confidence.into(),
        })
    }

    /// Analyze multiple issues in parallel
    pub async fn analyze_issues(&self, issues: Vec<CodeIssue>) -> Vec<MultiAgentAnalysis> {
        let mut analyses = Vec::new();

        // Process issues sequentially (parallel would require Arc<Mutex<>>)
        for issue in issues {
            if let Ok(analysis) = self.analyze_issue(&issue).await {
                analyses.push(analysis);
            }
        }

        analyses
    }

    /// Map issue type to multi-agent task type
    fn issue_type_to_task(&self, issue: &CodeIssue) -> TaskType {
        match issue.issue_type {
            IssueType::UnusedImport | IssueType::NamingViolation => TaskType::CodeGeneration,
            IssueType::MissingErrorHandling | IssueType::TypeMismatch => TaskType::Reasoning,
            IssueType::SecurityConcern => TaskType::SafetyCheck,
            IssueType::PerformanceIssue => TaskType::DataAnalysis,
            _ => TaskType::Comprehension,
        }
    }

    /// Create analysis prompt for issue
    fn create_analysis_prompt(&self, issue: &CodeIssue) -> String {
        format!(
            r#"Code Issue Analysis Request:

Issue ID: {}
Type: {}
Severity: {}
File: {}
Line: {}
Symbol: {}

Description: {}

Suggested Fix: {}

Pattern Violated: {}

Your task:
1. Analyze the issue in detail
2. Consider implications and edge cases
3. Evaluate the suggested fix quality
4. Identify any risks or improvements
5. Provide a clear recommendation

Focus on practical, implementable solutions.
"#,
            issue.id,
            issue.issue_type,
            issue.severity,
            issue.file.display(),
            issue.line_number,
            issue.symbol.as_ref().unwrap_or(&"(unknown)".to_string()),
            issue.description,
            issue.suggested_fix,
            issue
                .pattern_violated
                .as_ref()
                .unwrap_or(&"none".to_string())
        )
    }

    /// Extract suggested approach from agent response
    fn extract_approach(&self, response: &str) -> String {
        // Simple heuristic: look for first paragraph or sentence
        response
            .split('\n')
            .next()
            .unwrap_or("See full analysis")
            .to_string()
    }

    /// Determine recommended action based on severity and confidence
    fn determine_action(&self, issue: &CodeIssue, confidence: f64) -> RecommendedAction {
        match issue.severity {
            IssueSeverity::Critical => {
                if confidence > 0.85 {
                    RecommendedAction::AutoFix
                } else {
                    RecommendedAction::RequireReview
                }
            }
            IssueSeverity::Error => {
                if confidence > 0.75 {
                    RecommendedAction::AutoFix
                } else {
                    RecommendedAction::RequireReview
                }
            }
            IssueSeverity::Warning => {
                if confidence > 0.7 {
                    RecommendedAction::RequireReview
                } else {
                    RecommendedAction::Monitor
                }
            }
            IssueSeverity::Info => RecommendedAction::Defer,
        }
    }
}

/// Report generator for analysis results
pub struct AnalysisReporter {
    issues: Vec<MultiAgentAnalysis>,
}

impl AnalysisReporter {
    /// Create reporter from analyses
    pub fn new(issues: Vec<MultiAgentAnalysis>) -> Self {
        Self { issues }
    }

    /// Generate text report
    pub fn generate_text_report(&self) -> String {
        let mut report = String::new();

        report.push_str("# Code Analysis Report\n\n");
        report.push_str(&format!("Total Issues Analyzed: {}\n\n", self.issues.len()));

        // Group by severity
        let critical = self
            .issues
            .iter()
            .filter(|i| i.severity == IssueSeverity::Critical)
            .count();
        let errors = self
            .issues
            .iter()
            .filter(|i| i.severity == IssueSeverity::Error)
            .count();
        let warnings = self
            .issues
            .iter()
            .filter(|i| i.severity == IssueSeverity::Warning)
            .count();
        let infos = self
            .issues
            .iter()
            .filter(|i| i.severity == IssueSeverity::Info)
            .count();

        report.push_str("## Summary\n\n");
        if critical > 0 {
            report.push_str(&format!("🔴 Critical: {}\n", critical));
        }
        if errors > 0 {
            report.push_str(&format!("❌ Errors: {}\n", errors));
        }
        if warnings > 0 {
            report.push_str(&format!("⚠️ Warnings: {}\n", warnings));
        }
        if infos > 0 {
            report.push_str(&format!("ℹ️ Info: {}\n", infos));
        }
        report.push('\n');

        // Detailed breakdown
        report.push_str("## Issues by Recommended Action\n\n");

        for action in &[
            RecommendedAction::AutoFix,
            RecommendedAction::RequireReview,
            RecommendedAction::RequireManualFix,
            RecommendedAction::Monitor,
            RecommendedAction::Defer,
        ] {
            let count = self
                .issues
                .iter()
                .filter(|i| i.recommended_action == *action)
                .count();
            if count > 0 {
                report.push_str(&format!("### {}: {}\n\n", action, count));

                for analysis in self
                    .issues
                    .iter()
                    .filter(|i| i.recommended_action == *action)
                {
                    report.push_str(&format!(
                        "- **{}**: {}\n",
                        analysis.issue_id, analysis.issue_type
                    ));
                    report.push_str(&format!(
                        "  Confidence: {:.0}%\n",
                        analysis.confidence * 100.0
                    ));
                    report.push_str(&format!("  Consensus: {}\n\n", analysis.consensus));
                }
            }
        }

        report
    }

    /// Generate JSON report
    pub fn generate_json_report(&self) -> Result<String, String> {
        serde_json::to_string_pretty(&serde_json::json!({
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "total_issues": self.issues.len(),
            "issues": self.issues.iter().map(|i| {
                serde_json::json!({
                    "id": i.issue_id,
                    "type": format!("{}", i.issue_type),
                    "severity": format!("{}", i.severity),
                    "recommended_action": format!("{}", i.recommended_action),
                    "confidence": i.confidence,
                    "consensus": i.consensus,
                    "agent_count": i.agent_perspectives.len()
                })
            }).collect::<Vec<_>>()
        }))
        .map_err(|e| e.to_string())
    }

    /// Generate Telegram report (concise)
    pub fn generate_telegram_report(&self, max_issues: usize) -> String {
        let mut report = String::new();
        report.push_str("🔍 **Code Analysis Report**\n\n");

        // Summary line
        report.push_str(&format!("Total Issues: {}\n", self.issues.len()));

        // Group by severity
        let critical = self
            .issues
            .iter()
            .filter(|i| i.severity == IssueSeverity::Critical)
            .count();
        let errors = self
            .issues
            .iter()
            .filter(|i| i.severity == IssueSeverity::Error)
            .count();
        let warnings = self
            .issues
            .iter()
            .filter(|i| i.severity == IssueSeverity::Warning)
            .count();

        if critical > 0 {
            report.push_str(&format!("🔴 Critical: {}\n", critical));
        }
        if errors > 0 {
            report.push_str(&format!("❌ Errors: {}\n", errors));
        }
        if warnings > 0 {
            report.push_str(&format!("⚠️ Warnings: {}\n", warnings));
        }

        report.push_str("\n**Top Issues:**\n");

        // Show top N issues by severity
        let mut sorted = self.issues.clone();
        sorted.sort_by_key(|i| std::cmp::Reverse(i.severity));

        for (i, analysis) in sorted.iter().take(max_issues).enumerate() {
            report.push_str(&format!(
                "{}. {} - {} ({}% confidence)\n",
                i + 1,
                analysis.issue_id,
                analysis.issue_type,
                (analysis.confidence * 100.0) as u32
            ));
        }

        if self.issues.len() > max_issues {
            report.push_str(&format!(
                "\n... and {} more issues\n",
                self.issues.len() - max_issues
            ));
        }

        report
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_risk_level_display() {
        assert_eq!(RiskLevel::Low.to_string(), "🟢 Low");
        assert_eq!(RiskLevel::Medium.to_string(), "🟡 Medium");
        assert_eq!(RiskLevel::High.to_string(), "🔴 High");
    }

    #[test]
    fn test_recommended_action_display() {
        assert!(RecommendedAction::AutoFix.to_string().contains("Auto"));
        assert!(RecommendedAction::RequireReview
            .to_string()
            .contains("Review"));
    }

    #[test]
    fn test_analysis_reporter_new() {
        let reporter = AnalysisReporter::new(Vec::new());
        let text = reporter.generate_text_report();
        assert!(text.contains("Code Analysis Report"));
    }
}
