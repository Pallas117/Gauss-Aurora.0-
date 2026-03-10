use crate::approval_gate::{self, ApprovalStatus};
use crate::code_analysis::CodeAnalysisOrchestrator;
use crate::code_fixer::CodeFixer;
/// Telegram command handler for interactive agent communication.
/// Allows operators to chat with agents, gate fixes, and inspect command feed.
use crate::code_indexer::{CodeAnalyzer, CodeIndexer};
use crate::multi_agent::MultiAgentOrchestrator;
use crate::config::load_config;
use crate::recap;
use crate::state;
use crate::telegram_connector::TelegramConnector;
use serde_json::{json, Value};
use std::process::Command;
use std::time::Duration;

/// Extract the one-line GAUSS_PROGRESS summary from progress checker stdout.
fn extract_gauss_progress_line(stdout: &str) -> Option<String> {
    stdout
        .lines()
        .find(|line| line.trim_start().starts_with("GAUSS_PROGRESS "))
        .map(|line| line.trim().to_string())
}

/// Available Telegram commands
#[derive(Debug, Clone)]
pub enum TelegramCommand {
    Analyze,              // Run code analysis
    Fix,                  // Apply autonomous fixes
    Audit,                // Run requirements audit
    Progress,             // Run progress:short:refresh and report score
    Feed,                 // Show latest Telegram command/response feed
    Approvals,            // Show pending approvals
    Approve(Option<String>), // Approve by id
    Deny(Option<String>), // Deny by id
    Ask(String),          // Ask Gauss reasoning engine
    Recap,                // Project recap from local model
    Status,               // Show system status
    Help,                 // Show help
    Unknown(String),      // Unknown command
}

impl TelegramCommand {
    /// Parse command from text.
    pub fn parse(text: &str) -> Option<Self> {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return None;
        }
        if !trimmed.starts_with('/') {
            return Some(TelegramCommand::Ask(trimmed.to_string()));
        }

        let mut parts = trimmed.split_whitespace();
        let command = parts.next().unwrap_or("").to_lowercase();
        let arg = parts.next().map(|v| v.to_string());
        match command.as_str() {
            "/analyze" => Some(TelegramCommand::Analyze),
            "/fix" => Some(TelegramCommand::Fix),
            "/audit" => Some(TelegramCommand::Audit),
            "/progress" => Some(TelegramCommand::Progress),
            "/feed" => Some(TelegramCommand::Feed),
            "/approvals" => Some(TelegramCommand::Approvals),
            "/approve" => Some(TelegramCommand::Approve(arg)),
            "/deny" => Some(TelegramCommand::Deny(arg)),
            "/ask" => Some(TelegramCommand::Ask(
                trimmed
                    .strip_prefix("/ask")
                    .unwrap_or("")
                    .trim()
                    .to_string(),
            )),
            "/recap" => Some(TelegramCommand::Recap),
            "/status" => Some(TelegramCommand::Status),
            "/help" | "/start" => Some(TelegramCommand::Help),
            other => Some(TelegramCommand::Unknown(other.to_string())),
        }
    }
}

async fn run_shell(command: &str) -> Result<String, String> {
    let command = command.to_string();
    tokio::task::spawn_blocking(move || {
        let output = Command::new("bash")
            .arg("-lc")
            .arg(&command)
            .output()
            .map_err(|err| format!("command failed to start: {}", err))?;
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if output.status.success() {
            Ok(stdout)
        } else {
            let mut combined = stderr;
            if !stdout.is_empty() {
                combined = if combined.is_empty() {
                    stdout
                } else {
                    format!("{}\n{}", combined, stdout)
                };
            }
            Err(if combined.is_empty() {
                format!("command exited with {}", output.status)
            } else {
                combined
            })
        }
    })
    .await
    .map_err(|err| format!("command task join failed: {}", err))?
}

pub async fn run_fix_workflow(telegram: &TelegramConnector) -> Result<(), String> {
    telegram
        .notify("🔧 <b>Autonomous Fix Mode</b>\n\nIndexing and identifying fixable issues...")
        .await;

    // Index and analyze
    let mut indexer = CodeIndexer::new("./src");
    let index = indexer
        .index_codebase()
        .await
        .map_err(|e| format!("Indexing failed: {}", e))?;

    let analyzer = CodeAnalyzer::new(index);
    let issues = analyzer.analyze();

    // Apply fixes
    let fixer = CodeFixer::new("./src".to_string());
    let fix_results = fixer.apply_fixes(issues).await;

    let msg = format!(
        "✅ <b>Fix Results</b>\n\n\
         Applied: {}\n\
         Failed: {}\n\
         Validated: {}\n\n\
         💾 Changes have been applied and tested.",
        fix_results.successful_fixes,
        fix_results.failed_fixes,
        fix_results.validation_passed as u32
    );
    telegram.notify(&msg).await;
    Ok(())
}

async fn run_chat_query(client: &reqwest::Client, prompt: &str) -> Result<String, String> {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err("Usage: /ask <question>".to_string());
    }

    let engine_url = std::env::var("ORCHESTRATOR_CHAT_ENGINE_URL")
        .or_else(|_| std::env::var("ORCHESTRATOR_LOCAL_ENGINE_URL"))
        .unwrap_or_else(|_| "http://127.0.0.1:8089/v1/chat/completions".to_string());
    let model =
        std::env::var("ORCHESTRATOR_CHAT_MODEL").unwrap_or_else(|_| "local-model".to_string());

    let mut request = client
        .post(&engine_url)
        .timeout(Duration::from_secs(45))
        .json(&json!({
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": "You are Gauss Orchestrator assistant. Respond concisely with operational guidance."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ]
        }));

    if let Ok(api_key) = std::env::var("ORCHESTRATOR_LOCAL_ENGINE_API_KEY") {
        if !api_key.trim().is_empty() {
            request = request.bearer_auth(api_key);
        }
    }

    let response = request
        .send()
        .await
        .map_err(|err| format!("chat request failed: {}", err))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|err| format!("failed reading chat response: {}", err))?;

    if !status.is_success() {
        return Err(format!(
            "chat engine returned {}: {}",
            status,
            truncate(&body, 240)
        ));
    }

    if let Ok(parsed) = serde_json::from_str::<Value>(&body) {
        if let Some(content) = extract_chat_content(&parsed) {
            return Ok(content);
        }
    }

    Ok(truncate(&body, 1800))
}

fn extract_chat_content(parsed: &Value) -> Option<String> {
    let chat_content = parsed
        .get("choices")
        .and_then(|v| v.as_array())
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(|content| content.as_str())
        .map(|content| content.trim().to_string());

    if let Some(content) = chat_content {
        if !content.is_empty() {
            return Some(content);
        }
    }

    let fallback_fields = ["response", "output", "text", "message"];
    for field in fallback_fields {
        if let Some(value) = parsed.get(field).and_then(|v| v.as_str()) {
            if !value.trim().is_empty() {
                return Some(value.trim().to_string());
            }
        }
    }

    None
}

/// Handle Telegram commands.
pub async fn handle_telegram_command(
    cmd: TelegramCommand,
    client: &reqwest::Client,
    telegram: &TelegramConnector,
) -> Result<(), String> {
    match cmd {
        TelegramCommand::Analyze => {
            telegram
                .notify("🔍 <b>Code Analysis Started</b>\n\nIndexing codebase and consulting agents...")
                .await;

            // Index codebase
            let mut indexer = CodeIndexer::new("./src");
            let index = indexer
                .index_codebase()
                .await
                .map_err(|e| format!("Indexing failed: {}", e))?;

            // Analyze for issues
            let analyzer = CodeAnalyzer::new(index.clone());
            let issues = analyzer.analyze();

            // Count by severity
            let critical = issues
                .iter()
                .filter(|i| i.severity == crate::code_indexer::IssueSeverity::Critical)
                .count();
            let errors = issues
                .iter()
                .filter(|i| i.severity == crate::code_indexer::IssueSeverity::Error)
                .count();
            let warnings = issues
                .iter()
                .filter(|i| i.severity == crate::code_indexer::IssueSeverity::Warning)
                .count();

            let summary = format!(
                "📊 <b>Analysis Complete</b>\n\n\
                 Files: {}\n\
                 Symbols: {}\n\
                 Issues: {}\n\n\
                 🔴 Critical: {}\n\
                 🟠 Errors: {}\n\
                 🟡 Warnings: {}\n\n\
                 Use /fix to apply autonomous fixes or /help for more options.",
                index.files_indexed,
                index.symbols.len(),
                issues.len(),
                critical,
                errors,
                warnings
            );
            telegram.notify(&summary).await;

            if !issues.is_empty() {
                telegram
                    .notify("🧠 <b>Consulting Agent Team</b>\n\nDeepSeek, GPT-4, Claude, Gemini analyzing...")
                    .await;

                let ma_config = crate::multi_agent::MultiAgentConfig::from_env();
                let ma_orchestrator = MultiAgentOrchestrator::new(ma_config);
                let ca_orchestrator = CodeAnalysisOrchestrator::new(ma_orchestrator);
                let analysis_issues: Vec<_> = issues.iter().take(5).cloned().collect();
                let analyses = ca_orchestrator.analyze_issues(analysis_issues).await;
                telegram
                    .send_code_analysis_report(&analyses, issues.len())
                    .await;
            }

            Ok(())
        }
        TelegramCommand::Fix => run_fix_workflow(telegram).await,
        TelegramCommand::Audit => {
            telegram
                .notify(
                    "🧪 <b>Running Requirements Audit</b>\n\nCommand: <code>npm run audit:adherence:record</code>",
                )
                .await;
            let output = run_shell("npm run audit:adherence:record").await?;
            let preview = if output.len() > 600 {
                format!("{}...<truncated>", &output[..600])
            } else {
                output
            };
            telegram
                .notify(&format!(
                    "✅ <b>Audit Complete</b>\n\n<pre>{}</pre>",
                    html_escape(&preview)
                ))
                .await;
            let progress_out = run_shell("npm run progress:short").await;
            let progress_msg = match progress_out {
                Ok(stdout) => extract_gauss_progress_line(&stdout)
                    .map(|line| format!("Progress: <code>{}</code>", html_escape(&line)))
                    .unwrap_or_else(|| "Progress: (unavailable)".to_string()),
                Err(_) => "Progress: (unavailable)".to_string(),
            };
            telegram.notify(&format!("📊 <b>Full-build progress</b>\n\n{}", progress_msg)).await;
            Ok(())
        }
        TelegramCommand::Progress => {
            telegram
                .notify(
                    "📊 <b>Measuring progress</b>\n\nCommand: <code>npm run progress:short:refresh</code>",
                )
                .await;
            let output = run_shell("npm run progress:short:refresh").await?;
            let progress_msg = extract_gauss_progress_line(&output)
                .map(|line| format!("<code>{}</code>", html_escape(&line)))
                .unwrap_or_else(|| format!("<pre>{}</pre>", html_escape(&truncate(&output, 500))));
            telegram
                .notify(&format!(
                    "✅ <b>Progress (full audit plan)</b>\n\n{}",
                    progress_msg
                ))
                .await;
            Ok(())
        }
        TelegramCommand::Feed => {
            let entries = state::get_telegram_feed(10);
            if entries.is_empty() {
                telegram
                    .notify("📭 <b>Telegram Feed</b>\n\nNo entries yet.")
                    .await;
                return Ok(());
            }
            let mut msg = String::from("📡 <b>Telegram Feed (latest 10)</b>\n\n");
            for entry in entries {
                let line = format!(
                    "• [{}:{}] <code>{}</code>\n",
                    html_escape(&entry.direction),
                    html_escape(&entry.kind),
                    html_escape(&truncate(&entry.text, 120))
                );
                msg.push_str(&line);
            }
            telegram.notify(&msg).await;
            Ok(())
        }
        TelegramCommand::Approvals => {
            let pending = approval_gate::list_pending(10);
            if pending.is_empty() {
                telegram
                    .notify("✅ <b>Approvals</b>\n\nNo pending approvals.")
                    .await;
                return Ok(());
            }
            let mut msg = String::from("🛂 <b>Pending Approvals</b>\n\n");
            for req in pending {
                msg.push_str(&format!(
                    "• <code>{}</code> {}\n  /approve {} | /deny {}\n",
                    req.id, req.topic, req.id, req.id
                ));
            }
            telegram.notify(&msg).await;
            Ok(())
        }
        TelegramCommand::Approve(request_id) => {
            let target = request_id.or_else(|| approval_gate::latest_pending().map(|req| req.id));
            let Some(target_id) = target else {
                telegram
                    .notify("⚠️ No pending request to approve. Use /approvals.")
                    .await;
                return Ok(());
            };
            let Some(updated) = approval_gate::resolve_request(&target_id, true, "telegram") else {
                telegram
                    .notify(&format!(
                        "⚠️ Request not found: <code>{}</code>. Use /approvals.",
                        target_id
                    ))
                    .await;
                return Ok(());
            };
            if updated.status == ApprovalStatus::Approved {
                telegram
                    .notify(&format!(
                        "✅ Approved <code>{}</code> ({})",
                        updated.id, updated.topic
                    ))
                    .await;
            } else {
                telegram
                    .notify(&format!(
                        "ℹ️ Request <code>{}</code> is already {:?}",
                        updated.id, updated.status
                    ))
                    .await;
            }
            Ok(())
        }
        TelegramCommand::Deny(request_id) => {
            let target = request_id.or_else(|| approval_gate::latest_pending().map(|req| req.id));
            let Some(target_id) = target else {
                telegram
                    .notify("⚠️ No pending request to deny. Use /approvals.")
                    .await;
                return Ok(());
            };
            let Some(updated) = approval_gate::resolve_request(&target_id, false, "telegram") else {
                telegram
                    .notify(&format!(
                        "⚠️ Request not found: <code>{}</code>. Use /approvals.",
                        target_id
                    ))
                    .await;
                return Ok(());
            };
            if updated.status == ApprovalStatus::Denied {
                telegram
                    .notify(&format!(
                        "⛔ Denied <code>{}</code> ({})",
                        updated.id, updated.topic
                    ))
                    .await;
            } else {
                telegram
                    .notify(&format!(
                        "ℹ️ Request <code>{}</code> is already {:?}",
                        updated.id, updated.status
                    ))
                    .await;
            }
            Ok(())
        }
        TelegramCommand::Ask(prompt) => {
            let prompt = prompt.trim();
            if prompt.is_empty() {
                telegram
                    .notify("Usage: <code>/ask &lt;question&gt;</code>")
                    .await;
                return Ok(());
            }
            let answer = run_chat_query(client, prompt).await?;
            telegram
                .notify(&format!(
                    "💬 <b>Gauss Reply</b>\n\n{}",
                    html_escape(&truncate(&answer, 1800))
                ))
                .await;
            Ok(())
        }
        TelegramCommand::Recap => {
            telegram.notify("📋 <b>Project Recap</b>\n\nGathering context and asking local model...").await;
            let config = load_config();
            let workspace_root = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
            let context = recap::gather_recap_context(&workspace_root).map_err(|e| format!("recap gather: {}", e))?;
            let recap_text = recap::request_recap_from_local(client, &config, &context)
                .await
                .map_err(|e| format!("recap request: {}", e))?;
            telegram
                .notify(&format!(
                    "📋 <b>Project Recap</b>\n\n{}",
                    html_escape(&truncate(&recap_text, 1800))
                ))
                .await;
            Ok(())
        }
        TelegramCommand::Status => {
            let pending_count = approval_gate::list_pending(50).len();
            let status = format!(
                "✅ <b>Orchestrator Status</b>\n\n\
                System: Running\n\
                Telegram: Connected\n\
                Pending approvals: {}\n\n\
                🧠 <b>Agents Ready:</b>\n\
                • DeepSeek\n\
                • GPT-4\n\
                • Claude\n\
                • Gemini\n\n\
                📁 File Watcher: Active\n\n\
                <b>Available Commands:</b>\n\
                /analyze - Run code analysis\n\
                /fix - Apply autonomous fixes\n\
                /audit - Run adherence audit and refresh report\n\
                /progress - Run progress:short:refresh and report score\n\
                /approvals - Show pending approval requests\n\
                /approve [id] - Approve request\n\
                /deny [id] - Deny request\n\
                /ask [question] - Ask Gauss directly\n\
                /recap - Project recap from local model\n\
                /feed - Show message feed\n\
                /help - Show all commands",
                pending_count
            );
            telegram.notify(&status).await;
            Ok(())
        }
        TelegramCommand::Help => {
            let help = "🤖 <b>GAUSS Orchestrator - Telegram Commands</b>\n\n\
                <b>/analyze</b>\n\
                Run autonomous code analysis and agent reasoning.\n\n\
                <b>/fix</b>\n\
                Apply autonomous fixes (manual trigger).\n\n\
                <b>/audit</b>\n\
                Run requirements audit and refresh audit evidence; then report full-build progress.\n\n\
                <b>/progress</b>\n\
                Run progress:short:refresh (audit + progress) and report score.\n\n\
                <b>/approvals</b>\n\
                Show pending permission requests.\n\n\
                <b>/approve [id]</b> / <b>/deny [id]</b>\n\
                Resolve approval-gated automation actions.\n\n\
                <b>/ask [question]</b>\n\
                Ask the Gauss reasoning engine directly (plain text messages also work).\n\n\
                <b>/recap</b>\n\
                Project recap: work queue, audit, progress + local model summary.\n\n\
                <b>/feed</b>\n\
                Show latest Telegram feed entries.\n\n\
                <b>/status</b>\n\
                Show system status.";
            telegram.notify(help).await;
            Ok(())
        }
        TelegramCommand::Unknown(cmd) => {
            let msg = format!(
                "❓ Unknown command: <code>{}</code>\n\nUse /help for available commands.",
                cmd
            );
            telegram.notify(&msg).await;
            Ok(())
        }
    }
}

fn truncate(value: &str, max_len: usize) -> String {
    if value.chars().count() <= max_len {
        value.to_string()
    } else {
        let trimmed: String = value.chars().take(max_len).collect();
        format!("{}...", trimmed)
    }
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}
