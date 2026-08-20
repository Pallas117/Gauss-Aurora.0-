use crate::approval_gate::{self, ApprovalStatus};
use crate::config::load_config;
use crate::recap;
use crate::state;
use crate::telegram_commands;
use crate::telegram_connector::TelegramConnector;
use serde_json::Value;
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};

/// Parse ORCHESTRATOR_AUTO_APPROVE_UNTIL_UTC (RFC 3339, e.g. 2026-02-28T10:00:00Z).
/// If unset or invalid, returns None (approval required when configured).
fn auto_approve_deadline_utc() -> Option<chrono::DateTime<chrono::Utc>> {
    let s = std::env::var("ORCHESTRATOR_AUTO_APPROVE_UNTIL_UTC").ok()?;
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|dt| dt.with_timezone(&chrono::Utc))
}

fn parse_env_bool(name: &str, default_value: bool) -> bool {
    std::env::var(name)
        .ok()
        .map(|value| {
            let normalized = value.trim().to_lowercase();
            !["0", "false", "off", "no", "disabled"].contains(&normalized.as_str())
        })
        .unwrap_or(default_value)
}

fn env_u64(name: &str, fallback: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(fallback)
}

fn env_string(name: &str, fallback: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| fallback.to_string())
}

/// Run full-adherence-audit by path (node + tsx) from workspace root. Returns stdout on success.
fn run_audit_script_by_path(
    workspace_root: &std::path::Path,
    report_path: &str,
) -> Result<String, String> {
    let output = Command::new("node")
        .args([
            "--env-file-if-exists=.env",
            "--import",
            "tsx",
            "backend/scripts/full-adherence-audit.ts",
            "--json-out",
            report_path,
        ])
        .current_dir(workspace_root)
        .output()
        .map_err(|e| format!("audit script failed to start: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if output.status.success() {
        Ok(stdout.trim().to_string())
    } else {
        Err(format!("{}\n{}", stderr.trim(), stdout.trim()))
    }
}

fn run_shell(command: &str) -> Result<String, String> {
    let output = Command::new("bash")
        .arg("-lc")
        .arg(command)
        .output()
        .map_err(|err| format!("command failed to start: {}", err))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        Ok(stdout)
    } else {
        let combined = if stderr.is_empty() {
            stdout
        } else if stdout.is_empty() {
            stderr
        } else {
            format!("{}\n{}", stderr, stdout)
        };
        Err(if combined.is_empty() {
            format!("command exited with {}", output.status)
        } else {
            combined
        })
    }
}

fn background_command_warning(
    label: &str,
    result: &Result<Result<String, String>, tokio::task::JoinError>,
) -> Option<String> {
    match result {
        Ok(Ok(_)) => None,
        Ok(Err(error)) => Some(format!("{} failed: {}", label, preview(error, 400))),
        Err(error) => Some(format!("{} task failed: {}", label, error)),
    }
}

#[derive(Debug, Clone)]
struct AuditTotals {
    pass: u64,
    warn: u64,
    fail: u64,
}

fn parse_audit_totals(report_path: &str) -> Result<AuditTotals, String> {
    let content = std::fs::read_to_string(report_path)
        .map_err(|err| format!("unable to read {}: {}", report_path, err))?;
    let parsed: Value = serde_json::from_str(&content)
        .map_err(|err| format!("invalid json in {}: {}", report_path, err))?;
    let totals = parsed
        .get("totals")
        .and_then(|v| v.as_object())
        .ok_or_else(|| "totals missing in audit report".to_string())?;
    let pass = totals.get("pass").and_then(|v| v.as_u64()).unwrap_or(0);
    let warn = totals.get("warn").and_then(|v| v.as_u64()).unwrap_or(0);
    let fail = totals.get("fail").and_then(|v| v.as_u64()).unwrap_or(0);
    Ok(AuditTotals { pass, warn, fail })
}

/// Map audit check name to step index 8–12 (per AUDIT_STEPS.md).
fn step_index_for_check_name(name: &str) -> Option<u32> {
    match name {
        "Security Compliance Mapping Check" => Some(8),
        "Production Build" => Some(9),
        "Backend Environment Sanity" => Some(10),
        "Supabase RLS Smoke" => Some(11),
        "DTN+ISL Network Management Audit" => Some(12),
        _ => None,
    }
}

/// Parse checks array from audit report and format "Step 8: PASS | Step 9: ..." for steps 8–12.
/// Returns None if report or checks array is missing.
fn format_steps_8_12_line(report_path: &str) -> Option<String> {
    let content = std::fs::read_to_string(report_path).ok()?;
    let parsed: Value = serde_json::from_str(&content).ok()?;
    let checks = parsed.get("checks")?.as_array()?;
    let mut steps: std::collections::BTreeMap<u32, &str> = std::collections::BTreeMap::new();
    for check in checks {
        let obj = match check.as_object() {
            Some(o) => o,
            None => continue,
        };
        let name = match obj.get("name").and_then(|v| v.as_str()) {
            Some(n) => n,
            None => continue,
        };
        let status = obj.get("status").and_then(|v| v.as_str()).unwrap_or("?");
        if let Some(idx) = step_index_for_check_name(name) {
            steps.insert(idx, status);
        }
    }
    if steps.is_empty() {
        return None;
    }
    let parts: Vec<String> = (8..=12)
        .filter_map(|i| steps.get(&i).map(|s| format!("Step {}: {}", i, s)))
        .collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" | "))
    }
}

/// Parse security_compliance from audit report and format a one-line summary.
/// Returns None if the report has no security_compliance object.
fn format_security_compliance_summary(report_path: &str) -> Option<String> {
    let content = std::fs::read_to_string(report_path).ok()?;
    let parsed: Value = serde_json::from_str(&content).ok()?;
    let sc = parsed.get("security_compliance")?.as_object()?;
    let totals = sc.get("totals")?.as_object()?;
    let pass = totals.get("pass").and_then(|v| v.as_u64()).unwrap_or(0);
    let warn = totals.get("warn").and_then(|v| v.as_u64()).unwrap_or(0);
    let fail = totals.get("fail").and_then(|v| v.as_u64()).unwrap_or(0);
    let mut line = format!(
        "Security mapping: {} pass, {} warn, {} fail",
        pass, warn, fail
    );
    if fail > 0 {
        if let Some(controls) = sc.get("controls").and_then(|v| v.as_array()) {
            let failed_ids: Vec<String> = controls
                .iter()
                .filter_map(|c| {
                    let obj = c.as_object()?;
                    if obj.get("status")?.as_str() == Some("fail") {
                        obj.get("id").and_then(|v| v.as_str()).map(String::from)
                    } else {
                        None
                    }
                })
                .collect();
            if !failed_ids.is_empty() {
                line.push_str(" — ");
                line.push_str(&failed_ids.join(", "));
                line.push_str(" fail");
            }
        }
    }
    Some(line)
}

/// Extract the one-line GAUSS_PROGRESS summary from progress checker stdout.
fn extract_gauss_progress_line(stdout: &str) -> Option<String> {
    stdout
        .lines()
        .find(|line| line.trim_start().starts_with("GAUSS_PROGRESS "))
        .map(|line| line.trim().to_string())
}

fn preview(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    format!(
        "{}...<truncated>",
        text.chars().take(limit).collect::<String>()
    )
}

/// Format elapsed seconds as "Xm Ys" for Telegram.
fn format_timer(secs: u64) -> String {
    let m = secs / 60;
    let s = secs % 60;
    if m > 0 {
        format!("{}m {}s", m, s)
    } else {
        format!("{}s", s)
    }
}

/// Pipeline phase config: run a command, label for output.
#[derive(Clone)]
struct PhaseConfig {
    label: &'static str,
    command: String,
    allow_fail: bool,
}

/// Build pipeline phases from env (orchestrator tests → backend → E2E UI → frontend → fullscan).
fn build_automation_phases() -> Vec<PhaseConfig> {
    let parse = |name: &str, default: bool| {
        std::env::var(name)
            .ok()
            .map(|v| !["0", "false", "off", "no"].contains(&v.trim().to_lowercase().as_str()))
            .unwrap_or(default)
    };
    let mut phases = Vec::new();
    if parse("ORCHESTRATOR_AUTOMATION_PHASE_ORCHESTRATOR_TESTS", true) {
        phases.push(PhaseConfig {
            label: "orchestrator",
            command: "npm run test:orchestrator".to_string(),
            allow_fail: false,
        });
    }
    if parse("ORCHESTRATOR_AUTOMATION_PHASE_BACKEND_TESTS", true) {
        phases.push(PhaseConfig {
            label: "backend",
            command: "npm test".to_string(),
            allow_fail: false,
        });
    }
    if parse("ORCHESTRATOR_AUTOMATION_PHASE_E2E_UI", false) {
        phases.push(PhaseConfig {
            label: "e2e-ui",
            command: "npm run test:unit:ui".to_string(),
            allow_fail: true,
        });
    }
    if parse("ORCHESTRATOR_AUTOMATION_PHASE_FRONTEND", false) {
        phases.push(PhaseConfig {
            label: "frontend",
            command: "npm run lint && npm run test:unit:ui".to_string(),
            allow_fail: true,
        });
    }
    if parse("ORCHESTRATOR_AUTOMATION_PHASE_FULLSCAN", false) {
        phases.push(PhaseConfig {
            label: "fullscan",
            command: "npm run test:orchestrator:analyze".to_string(),
            allow_fail: true,
        });
    }
    phases
}

/// Run orchestrator phase natively via `cargo test --all-targets` in gauss-orchestrator/. Returns (stdout+stderr, success).
fn run_orchestrator_phase_native(workspace_root: &std::path::Path) -> (String, bool) {
    let orch_dir = workspace_root.join("gauss-orchestrator");
    if !orch_dir.join("Cargo.toml").exists() {
        return (
            "gauss-orchestrator/Cargo.toml not found; skip native phase".to_string(),
            false,
        );
    }
    match Command::new("cargo")
        .args(["test", "--all-targets"])
        .current_dir(&orch_dir)
        .output()
    {
        Ok(output) => {
            let out = String::from_utf8_lossy(&output.stdout);
            let err = String::from_utf8_lossy(&output.stderr);
            let combined = format!("{}\n{}", out.trim(), err.trim());
            (combined, output.status.success())
        }
        Err(e) => (format!("cargo test failed to start: {}", e), false),
    }
}

/// Run progress:short and return (progress line, elapsed secs). Call before sending Telegram messages.
async fn get_progress_and_timer(cycle_start: Instant) -> (Option<String>, u64) {
    let elapsed = cycle_start.elapsed().as_secs();
    let line = tokio::task::spawn_blocking(|| {
        run_shell("npm run progress:short")
            .ok()
            .and_then(|stdout| extract_gauss_progress_line(&stdout))
    })
    .await
    .ok()
    .flatten();
    (line, elapsed)
}

/// Prepend progress checker and cycle timer to a message body. Use before every Telegram send.
fn with_progress_timer_header(
    body: &str,
    progress_line: Option<&str>,
    elapsed_secs: u64,
) -> String {
    let line = progress_line.unwrap_or("—");
    format!(
        "⏱ Cycle: {} | {}\n\n{}",
        format_timer(elapsed_secs),
        line,
        body
    )
}

/// Run periodic audit automation in the background. Prioritises non-human steps;
/// human-in-the-loop only when WARN/FAIL and approval is required for the fix phase.
///
/// Flow: (1) Run audit + directive audit + progress (no human). (2) Optionally run
/// backprop and implementation report in background. (3) Notify. (4) If WARN/FAIL,
/// request approval; only then run fix command and optional /fix workflow.
pub async fn run_periodic_audit_automation(telegram: TelegramConnector) {
    let slack = crate::slack_connector::SlackConnector::from_env();
    let interval_secs = env_u64("ORCHESTRATOR_AUDIT_INTERVAL_SECS", 1800);
    let approval_timeout_secs = env_u64("ORCHESTRATOR_AUDIT_APPROVAL_TIMEOUT_SECS", 900);
    let audit_command = env_string(
        "ORCHESTRATOR_AUDIT_COMMAND",
        "npm run audit:adherence:record",
    );
    let fix_command = env_string(
        "ORCHESTRATOR_AUDIT_FIX_COMMAND",
        "npm run progress:short:refresh",
    );
    let report_path = env_string(
        "ORCHESTRATOR_AUDIT_REPORT_PATH",
        "reports/progress/requirements-audit.latest.json",
    );
    let directive_audit_command = std::env::var("ORCHESTRATOR_DIRECTIVE_AUDIT_COMMAND")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "npm run audit:directive:record".to_string());
    let directive_report_path = std::env::var("ORCHESTRATOR_DIRECTIVE_AUDIT_REPORT_PATH")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "reports/progress/directive-adherence.latest.json".to_string());
    let implementation_report_command = std::env::var("ORCHESTRATOR_IMPLEMENTATION_REPORT_COMMAND")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "npm run report:directive-implementations".to_string());
    let backprop_after_audit = parse_env_bool("ORCHESTRATOR_BACKPROP_AFTER_AUDIT", false);
    let backprop_command = env_string("ORCHESTRATOR_BACKPROP_COMMAND", "npm run context:backprop");
    let require_approval = parse_env_bool("ORCHESTRATOR_AUDIT_REQUIRE_APPROVAL", true);
    // Repository mutation is opt-in even after an approval message. Keep the
    // default proposal/notification-only so a chat integration cannot write
    // source files unexpectedly.
    let run_telegram_fix_workflow = parse_env_bool("ORCHESTRATOR_AUDIT_RUN_FIX_WORKFLOW", false);

    let phase_names: Vec<&str> = build_automation_phases().iter().map(|p| p.label).collect();
    let phases_desc = if phase_names.is_empty() {
        "none (audit only)".to_string()
    } else {
        phase_names.join(" → ")
    };
    telegram
        .notify(&format!(
            "🛰️ <b>Audit Automation Enabled</b> (background)\n\n\
             Pipeline: {} → audit → directive.\n\
             Every message includes ⏱ cycle timer and progress checker.\n\
             Human-in-the-loop only when WARN/FAIL for fix approval.\n\n\
             interval={}s | require_approval={} | backprop_after_audit={}\n\
             report=<code>{}</code>",
            phases_desc, interval_secs, require_approval, backprop_after_audit, report_path
        ))
        .await;
    if let Some(ref slack) = slack {
        let _ = slack
            .notify(&format!(
                "[Gauss] Local objective automation enabled. Pipeline: {}. Interval: {}s. Approval required: {}. Slack is notification-only.",
                phases_desc, interval_secs, require_approval
            ))
            .await;
    }

    let recap_at_cycle_start = parse_env_bool("ORCHESTRATOR_RECAP_AT_CYCLE_START", false);

    loop {
        let cycle_start = Instant::now();
        state::push_telegram_feed("system", "audit-cycle", "starting audit automation cycle");

        let workspace_root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

        if recap_at_cycle_start {
            if let Ok(context) = recap::gather_recap_context(&workspace_root) {
                let client = reqwest::Client::new();
                let config = load_config();
                if let Ok(text) = recap::request_recap_from_local(&client, &config, &context).await
                {
                    let path = workspace_root.join("reports/orchestrator/recap-latest.txt");
                    if let Some(parent) = path.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    let _ = std::fs::write(&path, &text);
                }
            }
        }

        let skip_heavy_phases = recap::battery_percent()
            .map(|b| b < recap::min_safe_battery_percent(&workspace_root))
            .unwrap_or(false);
        if skip_heavy_phases {
            telegram
                .notify("🔋 Battery below safe threshold; skipping test phases this cycle.")
                .await;
        }

        let phases = if skip_heavy_phases {
            vec![]
        } else {
            build_automation_phases()
        };
        let audit_cmd = audit_command.clone();
        let directive_cmd = directive_audit_command.clone();
        let use_audit_script_path = parse_env_bool("ORCHESTRATOR_AUDIT_USE_SCRIPT_PATH", false);
        let report_path_clone = report_path.clone();
        let command_result: Result<Result<String, String>, _> =
            tokio::task::spawn_blocking(move || {
                let mut combined = String::new();
                for p in &phases {
                    if p.label == "orchestrator" {
                        let (out, ok) = run_orchestrator_phase_native(&workspace_root);
                        if ok {
                            combined.push_str(&format!(
                                "[{}] PASS\n{}\n",
                                p.label,
                                preview(&out, 400)
                            ));
                        } else {
                            combined.push_str(&format!(
                                "[{}] FAIL\n{}\n",
                                p.label,
                                preview(&out, 400)
                            ));
                            if !p.allow_fail {
                                combined
                                    .push_str(&format!("(pipeline stopped after {})\n", p.label));
                            }
                        }
                    } else {
                        match run_shell(&p.command) {
                            Ok(out) => combined.push_str(&format!(
                                "[{}] PASS\n{}\n",
                                p.label,
                                preview(&out, 400)
                            )),
                            Err(e) => {
                                combined.push_str(&format!(
                                    "[{}] FAIL\n{}\n",
                                    p.label,
                                    preview(&e, 400)
                                ));
                                if !p.allow_fail {
                                    combined.push_str(&format!(
                                        "(pipeline stopped after {})\n",
                                        p.label
                                    ));
                                }
                            }
                        }
                    }
                }
                if !phases.is_empty() {
                    combined.push_str("\n--- audit ---\n");
                }
                let out1 = if use_audit_script_path {
                    run_audit_script_by_path(&workspace_root, &report_path_clone)
                } else {
                    run_shell(&audit_cmd)
                }?;
                let out2 = run_shell(&directive_cmd)
                    .unwrap_or_else(|e| format!("[directive audit] {}", e));
                Ok(format!(
                    "{}{}\n\n--- directive ---\n{}",
                    combined, out1, out2
                ))
            })
            .await;

        let run_output = match command_result {
            Ok(Ok(output)) => output,
            Ok(Err(err)) => {
                let (progress_line, elapsed) = get_progress_and_timer(cycle_start).await;
                let msg = format!(
                    "❌ <b>Audit Automation</b>\n\nAudit command failed:\n<pre>{}</pre>",
                    preview(&err, 800)
                );
                let body = with_progress_timer_header(&msg, progress_line.as_deref(), elapsed);
                telegram.notify(&body).await;
                state::push_telegram_feed("system", "audit-error", &err);
                tokio::time::sleep(Duration::from_secs(interval_secs.max(10))).await;
                continue;
            }
            Err(err) => {
                let (progress_line, elapsed) = get_progress_and_timer(cycle_start).await;
                let msg = format!(
                    "❌ <b>Audit Automation</b>\n\nJoin error: <code>{}</code>",
                    err
                );
                let body = with_progress_timer_header(&msg, progress_line.as_deref(), elapsed);
                telegram.notify(&body).await;
                tokio::time::sleep(Duration::from_secs(interval_secs.max(10))).await;
                continue;
            }
        };

        let mut totals = match parse_audit_totals(&report_path) {
            Ok(totals) => totals,
            Err(err) => {
                let (progress_line, elapsed) = get_progress_and_timer(cycle_start).await;
                let msg = format!(
                    "⚠️ <b>Audit Automation</b>\n\nUnable to parse audit totals: <code>{}</code>",
                    err
                );
                let body = with_progress_timer_header(&msg, progress_line.as_deref(), elapsed);
                telegram.notify(&body).await;
                tokio::time::sleep(Duration::from_secs(interval_secs.max(10))).await;
                continue;
            }
        };
        if let Ok(directive_totals) = parse_audit_totals(&directive_report_path) {
            totals.pass += directive_totals.pass;
            totals.warn += directive_totals.warn;
            totals.fail += directive_totals.fail;
        }

        // Run report and optional backprop concurrently, but await both before
        // publishing the cycle summary.  Fire-and-forget jobs could leave the
        // summary pointing at stale artifacts and hid command failures.
        let impl_report_cmd = implementation_report_command.clone();
        let implementation_task = tokio::task::spawn_blocking(move || run_shell(&impl_report_cmd));
        let backprop_task = backprop_after_audit.then(|| {
            let backprop_cmd = backprop_command.clone();
            tokio::task::spawn_blocking(move || run_shell(&backprop_cmd))
        });
        let implementation_result = implementation_task.await;
        let backprop_result = match backprop_task {
            Some(task) => Some(task.await),
            None => None,
        };
        let mut artifact_warnings = Vec::new();
        if let Some(warning) =
            background_command_warning("implementation report", &implementation_result)
        {
            state::push_telegram_feed("system", "automation-artifact-warning", &warning);
            artifact_warnings.push(warning);
        }
        if let Some(result) = backprop_result {
            if let Some(warning) = background_command_warning("backprop", &result) {
                state::push_telegram_feed("system", "automation-artifact-warning", &warning);
                artifact_warnings.push(warning);
            }
        }

        let progress_line = tokio::task::spawn_blocking(|| {
            run_shell("npm run progress:short")
                .ok()
                .and_then(|stdout| extract_gauss_progress_line(&stdout))
        })
        .await
        .ok()
        .flatten();

        let security_suffix = format_security_compliance_summary(&report_path)
            .map(|s| format!("\n\n{}", html_escape(&s)))
            .unwrap_or_default();

        let artifact_suffix = if artifact_warnings.is_empty() {
            String::new()
        } else {
            format!(
                "\n\nArtifact warnings: {}",
                html_escape(&artifact_warnings.join("; "))
            )
        };

        let steps_8_12 = format_steps_8_12_line(&report_path)
            .map(|s| format!("\n{}", html_escape(&s)))
            .unwrap_or_else(|| "\nSteps 8–12: (report unavailable)".to_string());

        let elapsed = cycle_start.elapsed().as_secs();
        let progress_header = progress_line.as_deref().unwrap_or("—");
        let summary = format!(
            "⏱ Cycle: {} | {}\n\n📋 <b>Audit Cycle Complete</b>\n\nPASS={} WARN={} FAIL={}{}{}{}\n\n<pre>{}</pre>",
            format_timer(elapsed),
            html_escape(progress_header),
            totals.pass,
            totals.warn,
            totals.fail,
            steps_8_12,
            security_suffix,
            artifact_suffix,
            html_escape(&preview(&run_output, 500))
        );
        telegram.notify(&summary).await;
        if let Some(ref slack) = slack {
            let _ = slack
                .notify(&format!(
                    "[Gauss] Objective cycle complete: PASS={} WARN={} FAIL={}. {}",
                    totals.pass,
                    totals.warn,
                    totals.fail,
                    preview(&run_output, 1_800)
                ))
                .await;
        }

        if totals.fail == 0 && totals.warn == 0 {
            let (progress_line2, elapsed2) = get_progress_and_timer(cycle_start).await;
            let msg = "✅ <b>Background automation complete.</b> No action needed—continue with your tasks.";
            let body = with_progress_timer_header(msg, progress_line2.as_deref(), elapsed2);
            telegram.notify(&body).await;
            tokio::time::sleep(Duration::from_secs(interval_secs.max(10))).await;
            continue;
        }

        if !telegram.enabled {
            state::push_telegram_feed(
                "system",
                "audit-fix-skipped",
                "telegram not configured; cannot request approval",
            );
            tokio::time::sleep(Duration::from_secs(interval_secs.max(10))).await;
            continue;
        }

        let within_auto_approve =
            auto_approve_deadline_utc().is_some_and(|d| chrono::Utc::now() < d);
        let mut skip_approval = !require_approval || within_auto_approve;

        if require_approval
            && !skip_approval
            && parse_env_bool("ORCHESTRATOR_MODEL_ASSISTED_FIX_DECISION", false)
        {
            let summary = format!(
                "Audit: PASS={} WARN={} FAIL={}. Progress: {}",
                totals.pass,
                totals.warn,
                totals.fail,
                progress_line.as_deref().unwrap_or("—")
            );
            let client = reqwest::Client::new();
            let config = load_config();
            if let Ok(recommendation) =
                recap::request_fix_recommendation(&client, &config, &summary).await
            {
                let up = recommendation.to_uppercase();
                if up.contains("RUN_FIX") {
                    skip_approval = true;
                    let (pl, el) = get_progress_and_timer(cycle_start).await;
                    let msg = format!(
                        "Model recommended RUN_FIX. Proceeding with fix phase without permission request.\nRecommendation: {}",
                        html_escape(recommendation.trim())
                    );
                    let body = with_progress_timer_header(&msg, pl.as_deref(), el);
                    telegram.notify(&body).await;
                }
            }
        }

        if skip_approval && within_auto_approve {
            let (pl, el) = get_progress_and_timer(cycle_start).await;
            let deadline_str = auto_approve_deadline_utc().unwrap().to_rfc3339();
            let msg = format!(
                "Auto-approve active until {} (UTC). Executing fix phase without permission request.",
                deadline_str
            );
            let body = with_progress_timer_header(&msg, pl.as_deref(), el);
            telegram.notify(&body).await;
        }

        if require_approval && !skip_approval {
            let (progress_line_approval, elapsed_approval) =
                get_progress_and_timer(cycle_start).await;
            let approval_body = format!(
                "Audit has WARN/FAIL gates (PASS={} WARN={} FAIL={}).\n\
                 Approve to run:\n\
                 • <code>{}</code>\n\
                 • fix workflow: {}",
                totals.pass,
                totals.warn,
                totals.fail,
                fix_command,
                if run_telegram_fix_workflow {
                    "enabled"
                } else {
                    "disabled"
                }
            );
            let approval_msg = with_progress_timer_header(
                &approval_body,
                progress_line_approval.as_deref(),
                elapsed_approval,
            );
            let req = match approval_gate::create_request(
                "audit-fix-phase",
                "Apply next-phase audit fixes now?",
                approval_timeout_secs,
            ) {
                Ok(request) => request,
                Err(error) => {
                    let message = format!(
                        "Approval request was not created: {}. No audit fix phase will run.",
                        error
                    );
                    state::push_telegram_feed("system", "approval-request-rejected", &message);
                    telegram
                        .notify(&format!("⚠️ {}", html_escape(&message)))
                        .await;
                    tokio::time::sleep(Duration::from_secs(interval_secs.max(10))).await;
                    continue;
                }
            };
            telegram
                .notify_permission_request(
                    &req.id,
                    "Permission Required: Audit Fix Phase",
                    &approval_msg,
                )
                .await;
            state::push_telegram_feed(
                "system",
                "approval-request",
                &format!("created approval request {}", req.id),
            );
            match approval_gate::wait_for_decision(&req.id, approval_timeout_secs).await {
                ApprovalStatus::Approved => {
                    let (pl, el) = get_progress_and_timer(cycle_start).await;
                    let msg = format!(
                        "✅ Approval received (<code>{}</code>). Executing audit fix phase.",
                        req.id
                    );
                    let body = with_progress_timer_header(&msg, pl.as_deref(), el);
                    telegram.notify(&body).await;
                }
                ApprovalStatus::Denied => {
                    let (pl, el) = get_progress_and_timer(cycle_start).await;
                    let msg = format!(
                        "⛔ Audit fix phase denied (<code>{}</code>). Skipping this cycle.",
                        req.id
                    );
                    let body = with_progress_timer_header(&msg, pl.as_deref(), el);
                    telegram.notify(&body).await;
                    tokio::time::sleep(Duration::from_secs(interval_secs.max(10))).await;
                    continue;
                }
                ApprovalStatus::Expired | ApprovalStatus::Pending => {
                    let (pl, el) = get_progress_and_timer(cycle_start).await;
                    let msg = format!(
                        "⌛ Approval timed out (<code>{}</code>). Skipping this cycle.",
                        req.id
                    );
                    let body = with_progress_timer_header(&msg, pl.as_deref(), el);
                    telegram.notify(&body).await;
                    tokio::time::sleep(Duration::from_secs(interval_secs.max(10))).await;
                    continue;
                }
            }
        }

        let fix_result = tokio::task::spawn_blocking({
            let fix_command = fix_command.clone();
            move || run_shell(&fix_command)
        })
        .await;

        match fix_result {
            Ok(Ok(output)) => {
                let (pl, el) = get_progress_and_timer(cycle_start).await;
                let msg = format!(
                    "🛠️ <b>Audit Fix Command Complete</b>\n<pre>{}</pre>",
                    html_escape(&preview(&output, 700))
                );
                let body = with_progress_timer_header(&msg, pl.as_deref(), el);
                telegram.notify(&body).await;
                let run_patch_loop = parse_env_bool("ORCHESTRATOR_PATCH_BATCH_LOOP_ENABLED", true);
                if run_patch_loop {
                    let work_queue_path = std::env::var("ORCHESTRATOR_WORK_QUEUE_PATH")
                        .unwrap_or_else(|_| "reports/orchestrator/work-queue.json".to_string());
                    let issues_path =
                        crate::code_analysis::work_queue_issues_path(&work_queue_path);
                    let issues = crate::code_analysis::load_issues(&issues_path);
                    if let Err(e) = crate::autonomous_loop::run_patch_batch_loop(
                        &work_queue_path,
                        &issues,
                        &telegram,
                    )
                    .await
                    {
                        let (pl2, el2) = get_progress_and_timer(cycle_start).await;
                        let msg2 = format!(
                            "⚠️ Patch batch loop failed: <code>{}</code>",
                            html_escape(&e)
                        );
                        let body2 = with_progress_timer_header(&msg2, pl2.as_deref(), el2);
                        telegram.notify(&body2).await;
                    }
                }
                if run_telegram_fix_workflow {
                    if let Err(err) = telegram_commands::run_fix_workflow(&telegram).await {
                        let (pl2, el2) = get_progress_and_timer(cycle_start).await;
                        let msg2 = format!(
                            "⚠️ Fix workflow failed after audit command: <code>{}</code>",
                            html_escape(&err)
                        );
                        let body2 = with_progress_timer_header(&msg2, pl2.as_deref(), el2);
                        telegram.notify(&body2).await;
                    }
                }
            }
            Ok(Err(err)) => {
                let (pl, el) = get_progress_and_timer(cycle_start).await;
                let msg = format!(
                    "❌ <b>Audit Fix Command Failed</b>\n<pre>{}</pre>",
                    html_escape(&preview(&err, 700))
                );
                let body = with_progress_timer_header(&msg, pl.as_deref(), el);
                telegram.notify(&body).await;
            }
            Err(err) => {
                let (pl, el) = get_progress_and_timer(cycle_start).await;
                let msg = format!(
                    "❌ <b>Audit Fix Command Join Error</b>\n<code>{}</code>",
                    err
                );
                let body = with_progress_timer_header(&msg, pl.as_deref(), el);
                telegram.notify(&body).await;
            }
        }

        tokio::time::sleep(Duration::from_secs(interval_secs.max(10))).await;
    }
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn background_command_success_is_silent() {
        let result = Ok(Ok("complete".to_string()));
        assert_eq!(background_command_warning("report", &result), None);
    }

    #[test]
    fn background_command_failure_is_reported() {
        let result = Ok(Err("permission denied".to_string()));
        assert_eq!(
            background_command_warning("backprop", &result),
            Some("backprop failed: permission denied".to_string())
        );
    }
}
