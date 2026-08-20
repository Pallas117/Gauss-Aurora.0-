//! Project recap: gather work queue, audit report, progress, optional docs; ask local model for narrative summary.
//! Used by Telegram /recap and optionally at audit cycle start. No ML loaded in-process; HTTP to local engine only.

use crate::config::OrchestratorConfig;
use reqwest::Client;
use serde_json::json;
use std::path::Path;
use std::time::Duration;

const DEFAULT_RECAP_MAX_TOKENS: u32 = 600;
const DEFAULT_RECAP_DOCS_MAX_BYTES: usize = 3072;

/// Context gathered for the recap prompt (work queue, audit totals, progress line, optional doc snippets).
#[derive(Debug, Clone, Default)]
pub struct RecapContext {
    pub work_queue_summary: String,
    pub audit_summary: String,
    pub progress_line: Option<String>,
    pub docs_snippet: Option<String>,
}

/// Read min_safe_battery_percent and total_estimated_minutes from work-queue JSON; format a short summary.
fn summarize_work_queue(content: &str) -> String {
    let parsed: serde_json::Value = match serde_json::from_str(content) {
        Ok(v) => v,
        Err(_) => return "(work queue unreadable)".to_string(),
    };
    let items = parsed
        .get("items")
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    let total_min = parsed
        .get("total_estimated_minutes")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let min_batt = parsed
        .get("min_safe_battery_percent")
        .and_then(|v| v.as_u64())
        .unwrap_or(25);
    let ts = parsed
        .get("timestamp")
        .and_then(|v| v.as_str())
        .unwrap_or("—");
    format!(
        "Work queue: {} items, {} min estimated, min_safe_battery={}%, timestamp={}",
        items, total_min, min_batt, ts
    )
}

/// Read audit totals (pass/warn/fail) from requirements-audit JSON.
fn summarize_audit(content: &str) -> String {
    let parsed: serde_json::Value = match serde_json::from_str(content) {
        Ok(v) => v,
        Err(_) => return "(audit report unreadable)".to_string(),
    };
    let totals = match parsed.get("totals").and_then(|v| v.as_object()) {
        Some(t) => t,
        None => return "(audit totals missing)".to_string(),
    };
    let pass = totals.get("pass").and_then(|v| v.as_u64()).unwrap_or(0);
    let warn = totals.get("warn").and_then(|v| v.as_u64()).unwrap_or(0);
    let fail = totals.get("fail").and_then(|v| v.as_u64()).unwrap_or(0);
    format!("Audit: PASS={} WARN={} FAIL={}", pass, warn, fail)
}

/// Extract the one-line GAUSS_PROGRESS summary from progress checker stdout.
fn extract_gauss_progress_line(stdout: &str) -> Option<String> {
    stdout
        .lines()
        .find(|line| line.trim_start().starts_with("GAUSS_PROGRESS "))
        .map(|line| line.trim().to_string())
}

/// Run progress:short via shell and return GAUSS_PROGRESS line if present. Requires workspace root cwd.
fn run_progress_short(workspace_root: &Path) -> Option<String> {
    let output = std::process::Command::new("bash")
        .arg("-lc")
        .arg("npm run progress:short")
        .current_dir(workspace_root)
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    extract_gauss_progress_line(&stdout)
}

/// Gather recap context from workspace: work queue, audit report, progress line, optional docs.
/// Paths are relative to workspace_root. Missing files are skipped (summary string indicates missing).
pub fn gather_recap_context(workspace_root: &Path) -> Result<RecapContext, String> {
    let work_queue_path = std::env::var("ORCHESTRATOR_WORK_QUEUE_PATH")
        .unwrap_or_else(|_| "reports/orchestrator/work-queue.json".to_string());
    let audit_report_path = std::env::var("ORCHESTRATOR_AUDIT_REPORT_PATH")
        .unwrap_or_else(|_| "reports/progress/requirements-audit.latest.json".to_string());
    let docs_max_bytes = std::env::var("ORCHESTRATOR_RECAP_DOCS_MAX_BYTES")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(DEFAULT_RECAP_DOCS_MAX_BYTES);

    let work_queue_summary = std::fs::read_to_string(workspace_root.join(&work_queue_path))
        .map(|c| summarize_work_queue(&c))
        .unwrap_or_else(|_| format!("(work queue not found: {})", work_queue_path));

    let audit_summary = std::fs::read_to_string(workspace_root.join(&audit_report_path))
        .map(|c| summarize_audit(&c))
        .unwrap_or_else(|_| format!("(audit report not found: {})", audit_report_path));

    let progress_line = run_progress_short(workspace_root);

    let mut docs_parts = Vec::new();
    for (rel_path, label) in [
        ("docs/WORKSPACE_MAP.md", "WORKSPACE_MAP"),
        ("docs/PROJECT_GAUSS_PLAIN_ENGLISH.md", "PROJECT_GAUSS"),
    ] {
        if let Ok(content) = std::fs::read_to_string(workspace_root.join(rel_path)) {
            let take = content.len().min(docs_max_bytes / 2);
            let snippet = if take < content.len() {
                format!(
                    "{}... (truncated)",
                    content.chars().take(take).collect::<String>()
                )
            } else {
                content
            };
            docs_parts.push(format!("[{}]\n{}", label, snippet));
        }
    }
    let docs_snippet = if docs_parts.is_empty() {
        None
    } else {
        Some(docs_parts.join("\n\n"))
    };

    Ok(RecapContext {
        work_queue_summary,
        audit_summary,
        progress_line,
        docs_snippet,
    })
}

/// Build the user message body for the recap request.
fn build_recap_user_message(context: &RecapContext) -> String {
    let progress = context
        .progress_line
        .as_deref()
        .unwrap_or("(progress not run)");
    let mut parts = vec![
        context.work_queue_summary.clone(),
        context.audit_summary.clone(),
        format!("Progress: {}", progress),
    ];
    if let Some(ref docs) = context.docs_snippet {
        parts.push(format!("Project context:\n{}", docs));
    }
    parts.push(
        "Based on the above, write a brief project recap (3–5 sentences): current status, main risks or gaps, and suggested next steps. Be concise and operational.".to_string(),
    );
    parts.join("\n\n")
}

/// Call the local chat engine with the recap context; return the model's recap text.
pub async fn request_recap_from_local(
    client: &Client,
    config: &OrchestratorConfig,
    context: &RecapContext,
) -> Result<String, String> {
    let user_content = build_recap_user_message(context);
    let payload = json!({
        "model": config.local_engine_model,
        "messages": [
            {
                "role": "system",
                "content": "You are the Gauss mission operator. Summarize project status and suggest next steps based on work queue, audit, and progress. Respond in plain text, 3–5 sentences."
            },
            { "role": "user", "content": user_content }
        ],
        "temperature": 0.3,
        "max_tokens": DEFAULT_RECAP_MAX_TOKENS
    });

    let timeout = Duration::from_secs(config.http_timeout_seconds.max(15));
    let mut request = client
        .post(&config.local_engine_url)
        .json(&payload)
        .timeout(timeout);

    if let Some(api_key) = &config.local_engine_api_key {
        if !api_key.is_empty() {
            request = request.bearer_auth(api_key);
        }
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("recap request failed: {}", e))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("recap response read failed: {}", e))?;

    if !status.is_success() {
        return Err(format!(
            "local engine returned {}: {}",
            status,
            body.chars().take(300).collect::<String>()
        ));
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("recap JSON parse failed: {}", e))?;
    let content = parsed
        .get("choices")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .map(|s| s.trim().to_string());

    content.ok_or_else(|| "recap response missing choices[0].message.content".to_string())
}

/// Read min_safe_battery_percent from work-queue.json if present; else default 25.
pub fn min_safe_battery_percent(workspace_root: &Path) -> u8 {
    let path = std::env::var("ORCHESTRATOR_WORK_QUEUE_PATH")
        .unwrap_or_else(|_| "reports/orchestrator/work-queue.json".to_string());
    let content = match std::fs::read_to_string(workspace_root.join(&path)) {
        Ok(c) => c,
        Err(_) => return 25,
    };
    let parsed: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return 25,
    };
    parsed
        .get("min_safe_battery_percent")
        .and_then(|v| v.as_u64())
        .map(|n| n.min(100) as u8)
        .unwrap_or(25)
}

/// Ask local model for one-line fix recommendation (RUN_FIX / DEFER / ASK_HUMAN). Env-gated use in audit automation.
pub async fn request_fix_recommendation(
    client: &Client,
    config: &OrchestratorConfig,
    audit_and_progress_summary: &str,
) -> Result<String, String> {
    let user_content = format!(
        "Audit and progress summary:\n{}\n\nReply with exactly one of: RUN_FIX, DEFER, or ASK_HUMAN. No other text.",
        audit_and_progress_summary
    );
    let payload = json!({
        "model": config.local_engine_model,
        "messages": [
            {
                "role": "system",
                "content": "You are the Gauss mission operator. Based on audit results and progress, recommend whether to run the fix phase now. Reply with only RUN_FIX, DEFER, or ASK_HUMAN."
            },
            { "role": "user", "content": user_content }
        ],
        "temperature": 0.1,
        "max_tokens": 20
    });

    let timeout = Duration::from_secs(config.http_timeout_seconds.max(15));
    let mut request = client
        .post(&config.local_engine_url)
        .json(&payload)
        .timeout(timeout);

    if let Some(api_key) = &config.local_engine_api_key {
        if !api_key.is_empty() {
            request = request.bearer_auth(api_key);
        }
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("fix recommendation request failed: {}", e))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("fix recommendation response read failed: {}", e))?;

    if !status.is_success() {
        return Err(format!(
            "local engine returned {}: {}",
            status,
            body.chars().take(200).collect::<String>()
        ));
    }

    let parsed: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("fix recommendation JSON parse failed: {}", e))?;
    let content = parsed
        .get("choices")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .map(|s| s.trim().to_string());

    content
        .ok_or_else(|| "fix recommendation response missing choices[0].message.content".to_string())
}

/// Optional: get battery percent from env or macOS pmset. Returns None if unknown or not darwin.
pub fn battery_percent() -> Option<u8> {
    if let Ok(v) = std::env::var("BATTERY_PERCENT") {
        let s = v.trim();
        if !s.is_empty() {
            if let Ok(n) = s.parse::<u8>() {
                return Some(n.min(100));
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("pmset")
            .args(["-g", "batt"])
            .output()
            .ok()?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let needle = "%";
        if let Some(idx) = stdout.rfind(needle) {
            let before = &stdout[..idx];
            let digits: String = before
                .chars()
                .rev()
                .take_while(|c| c.is_ascii_digit())
                .collect::<String>()
                .chars()
                .rev()
                .collect();
            if !digits.is_empty() {
                if let Ok(n) = digits.parse::<u8>() {
                    return Some(n.min(100));
                }
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = ();

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summarize_work_queue_parses_valid_json() {
        let json = r#"{"items":[],"total_estimated_minutes":120,"min_safe_battery_percent":25,"timestamp":"2026-01-01T00:00:00Z"}"#;
        let s = summarize_work_queue(json);
        assert!(s.contains("0 items"));
        assert!(s.contains("120 min"));
        assert!(s.contains("min_safe_battery=25"));
    }

    #[test]
    fn summarize_work_queue_handles_invalid() {
        let s = summarize_work_queue("not json");
        assert!(s.contains("unreadable"));
    }

    #[test]
    fn summarize_audit_parses_totals() {
        let json = r#"{"totals":{"pass":10,"warn":1,"fail":0}}"#;
        let s = summarize_audit(json);
        assert!(s.contains("PASS=10"));
        assert!(s.contains("WARN=1"));
        assert!(s.contains("FAIL=0"));
    }

    #[test]
    fn summarize_audit_handles_missing_totals() {
        let s = summarize_audit(r#"{"checks":[]}"#);
        assert!(s.contains("missing"));
    }

    #[test]
    fn extract_gauss_progress_line_finds_line() {
        let out = "other\n  GAUSS_PROGRESS overall=78% V0.2=78%\nmore";
        assert_eq!(
            extract_gauss_progress_line(out),
            Some("GAUSS_PROGRESS overall=78% V0.2=78%".to_string())
        );
    }

    #[test]
    fn extract_gauss_progress_line_returns_none_when_absent() {
        assert!(extract_gauss_progress_line("no match").is_none());
    }

    #[test]
    fn gather_recap_context_reads_work_queue_and_audit() {
        let dir = tempfile::tempdir().expect("temp dir");
        let root = dir.path();
        std::fs::create_dir_all(root.join("reports/orchestrator")).ok();
        std::fs::create_dir_all(root.join("reports/progress")).ok();
        std::fs::write(
            root.join("reports/orchestrator/work-queue.json"),
            r#"{"items":[{"id":"1","title":"Fix x"}],"total_estimated_minutes":60,"min_safe_battery_percent":25,"timestamp":"2026-01-01T00:00:00Z"}"#,
        )
        .unwrap();
        std::fs::write(
            root.join("reports/progress/requirements-audit.latest.json"),
            r#"{"totals":{"pass":8,"warn":1,"fail":0}}"#,
        )
        .unwrap();
        let ctx = gather_recap_context(root).expect("gather");
        assert!(ctx.work_queue_summary.contains("1 items"));
        assert!(ctx.work_queue_summary.contains("60 min"));
        assert!(ctx.audit_summary.contains("PASS=8"));
        assert!(ctx.audit_summary.contains("WARN=1"));
    }

    #[test]
    fn min_safe_battery_percent_from_work_queue() {
        let dir = tempfile::tempdir().expect("temp dir");
        let root = dir.path();
        std::fs::create_dir_all(root.join("reports/orchestrator")).ok();
        std::fs::write(
            root.join("reports/orchestrator/work-queue.json"),
            r#"{"min_safe_battery_percent":40}"#,
        )
        .unwrap();
        assert_eq!(min_safe_battery_percent(root), 40);
    }
}
