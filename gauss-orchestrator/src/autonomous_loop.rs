//! Small-batch patch loop: read work queue, apply fixes in batches, run backprop, evaluate, notify.
//! Used when audit automation runs the fix phase (after approval or auto-approve).

use crate::code_analysis::{WorkQueue, WorkQueueItem};
use crate::code_fixer::CodeFixer;
use crate::code_indexer::CodeIssue;
use crate::telegram_connector::TelegramConnector;
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

fn env_u64(name: &str, fallback: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(fallback)
}

fn run_shell(command: &str) -> Result<String, String> {
    let output = Command::new("bash")
        .arg("-lc")
        .arg(command)
        .output()
        .map_err(|e| e.to_string())?;
    let out = String::from_utf8_lossy(&output.stdout);
    let err = String::from_utf8_lossy(&output.stderr);
    if output.status.success() {
        Ok(out.trim().to_string())
    } else {
        Err(format!("{}\n{}", err.trim(), out.trim()))
    }
}

/// Evaluation record for one batch (self-learning).
#[derive(Debug, Serialize)]
pub struct AutonomousEval {
    pub timestamp: String,
    pub batch_index: usize,
    pub issues_attempted: usize,
    pub issues_fixed: usize,
    pub audit_pass_before: Option<u64>,
    pub audit_pass_after: Option<u64>,
    pub progress_pct_before: Option<f64>,
    pub progress_pct_after: Option<f64>,
}

/// Read work queue JSON from path. Returns empty queue on error.
fn read_work_queue_simple(path: &Path) -> WorkQueue {
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return WorkQueue {
            timestamp: String::new(),
            total_estimated_minutes: 0,
            min_safe_battery_percent: 25,
            scheduling_buffer_minutes: 0,
            items: Vec::new(),
        },
    };
    serde_json::from_str(&content).unwrap_or_else(|_| WorkQueue {
        timestamp: String::new(),
        total_estimated_minutes: 0,
        min_safe_battery_percent: 25,
        scheduling_buffer_minutes: 0,
        items: Vec::new(),
    })
}

fn project_root_for_file(file: &str) -> &'static str {
    if file.starts_with("gauss-orchestrator/") || file.contains("gauss-orchestrator\\") {
        "gauss-orchestrator"
    } else {
        "."
    }
}

/// Run the small-batch patch loop: read queue, sort, for each batch apply fixes (Rust only),
/// run backprop, evaluate, append to log, notify.
pub async fn run_patch_batch_loop(
    work_queue_path: &str,
    issues: &[CodeIssue],
    telegram: &TelegramConnector,
) -> Result<(), String> {
    let path = Path::new(work_queue_path);
    let mut queue = read_work_queue_simple(path);

    let batch_size = env_u64("ORCHESTRATOR_PATCH_BATCH_SIZE", 2) as usize;
    let max_batches = env_u64("ORCHESTRATOR_MAX_PATCH_BATCHES_PER_CYCLE", 10) as usize;
    let eval_log_path = PathBuf::from("reports/context/autonomous-evaluation.jsonl");

    // Sort by priority (desc), then estimated_minutes (asc)
    queue.items.sort_by(|a, b| {
        b.priority.cmp(&a.priority).then_with(|| a.estimated_minutes.cmp(&b.estimated_minutes))
    });

    let mut batch_index = 0usize;
    let mut issues_fixed_total = 0usize;

    while batch_index < max_batches {
        let from = batch_index * batch_size;
        if from >= queue.items.len() {
            break;
        }
        let to = (from + batch_size).min(queue.items.len());
        let batch_items: Vec<WorkQueueItem> = queue.items[from..to].to_vec();
        batch_index += 1;

        let mut issues_attempted = 0usize;
        let mut issues_fixed = 0usize;

        for item in &batch_items {
            if item.file.is_empty() || !item.file.ends_with(".rs") {
                continue;
            }
            let issue = match issues.iter().find(|i| i.id == item.id) {
                Some(i) => i,
                None => continue,
            };
            issues_attempted += 1;
            let root = project_root_for_file(&item.file);
            let fixer = CodeFixer::new(root);
            let result = fixer.apply_fix(issue).await;
            if result.success && result.validation_passed {
                issues_fixed += 1;
            }
        }

        issues_fixed_total += issues_fixed;

        // Backprop
        let _ = run_shell("npm run context:backprop");

        // Evaluate: read audit and backprop if present; store for AutonomousEval (self-learning)
        let audit_path = Path::new("reports/progress/requirements-audit.latest.json");
        let backprop_path = Path::new("reports/context/latest-backprop.json");
        let pass_before: Option<u64> = None;
        let mut pass_after: Option<u64> = None;
        let progress_before: Option<f64> = None;
        let mut progress_pct_after: Option<f64> = None;
        if audit_path.exists() {
            if let Ok(c) = fs::read_to_string(audit_path) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&c) {
                    pass_after = v.get("totals").and_then(|t| t.get("pass")).and_then(|p| p.as_u64());
                }
            }
        }
        if backprop_path.exists() {
            if let Ok(c) = fs::read_to_string(backprop_path) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&c) {
                    progress_pct_after = v
                        .get("readiness")
                        .and_then(|r| r.get("overall"))
                        .and_then(|n| n.as_f64());
                }
            }
        }

        let eval = AutonomousEval {
            timestamp: chrono::Utc::now().to_rfc3339(),
            batch_index,
            issues_attempted,
            issues_fixed,
            audit_pass_before: pass_before,
            audit_pass_after: pass_after,
            progress_pct_before: progress_before,
            progress_pct_after: progress_pct_after,
        };
        if let Ok(line) = serde_json::to_string(&eval) {
            if let Some(parent) = eval_log_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&eval_log_path)
                .and_then(|mut f| writeln!(f, "{}", line));
        }

        let msg = format!(
            "Batch {}: attempted {} fixes, {} applied. Backprop done. Total fixed this cycle: {}.",
            batch_index, issues_attempted, issues_fixed, issues_fixed_total
        );
        telegram.notify(&format!("<b>Autonomous patch batch</b>\n\n{}", msg)).await;
    }

    Ok(())
}
