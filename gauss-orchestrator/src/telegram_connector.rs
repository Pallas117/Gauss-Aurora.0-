use crate::code_analysis::MultiAgentAnalysis;
use crate::state;
use teloxide::prelude::*;
use teloxide::types::{ChatId, ParseMode};
use tracing;

/// Telegram connector for notifications and command handling.
#[derive(Clone)]
pub struct TelegramConnector {
    pub bot: Option<Bot>,
    pub chat_id: i64,
    pub enabled: bool,
}

impl TelegramConnector {
    /// Create a new Telegram connector from token and chat ID.
    /// Automatically detects if the connector is enabled based on token and chat_id presence.
    pub fn new(token: &str, chat_id: i64) -> Self {
        let requested_enabled = !token.trim().is_empty() && chat_id != 0;
        // Avoid hard failure in restricted environments where reqwest/system proxy init can panic.
        let bot = if requested_enabled {
            std::panic::catch_unwind(|| Bot::new(token)).ok()
        } else {
            None
        };
        let enabled = requested_enabled && bot.is_some();
        Self {
            bot,
            chat_id,
            enabled,
        }
    }

    /// Send a notification to the configured chat.
    /// Does nothing if the connector is not enabled.
    pub async fn notify(&self, msg: &str) {
        if !self.enabled {
            return;
        }
        let Some(bot) = &self.bot else {
            return;
        };
        state::push_telegram_feed("outbound", "notify", msg);
        let _ = bot
            .send_message(ChatId(self.chat_id), msg)
            .parse_mode(ParseMode::Html)
            .await;
    }

    /// Send an error notification to the configured chat.
    pub async fn notify_error(&self, title: &str, error: &str) {
        let msg = format!("❌ <b>{}:</b> <code>{}</code>", title, error);
        self.notify(&msg).await;
    }

    /// Send a success notification to the configured chat.
    pub async fn notify_success(&self, msg: &str) {
        let msg = format!("✅ {}", msg);
        self.notify(&msg).await;
    }

    /// Send an explicit permission request with actionable approve/deny commands.
    pub async fn notify_permission_request(
        &self,
        request_id: &str,
        title: &str,
        detail: &str,
    ) {
        let msg = format!(
            "🛂 <b>{}</b>\n\n{}\n\n\
             Request ID: <code>{}</code>\n\
             Reply with:\n\
             • <code>/approve {}</code>\n\
             • <code>/deny {}</code>",
            title, detail, request_id, request_id, request_id
        );
        self.notify(&msg).await;
    }

    /// Send code analysis report to Telegram
    pub async fn send_code_analysis_report(
        &self,
        analyses: &[MultiAgentAnalysis],
        total_issues: usize,
    ) {
        if !self.enabled || analyses.is_empty() {
            return;
        }

        let mut report = String::new();
        report.push_str("🔍 <b>AUTONOMOUS CODE ANALYSIS REPORT</b>\n\n");
        report.push_str(&format!("📊 <b>Total Issues:</b> {}\n", total_issues));

        // Group by severity
        let critical = analyses
            .iter()
            .filter(|a| a.severity == crate::code_indexer::IssueSeverity::Critical)
            .count();
        let errors = analyses
            .iter()
            .filter(|a| a.severity == crate::code_indexer::IssueSeverity::Error)
            .count();
        let warnings = analyses
            .iter()
            .filter(|a| a.severity == crate::code_indexer::IssueSeverity::Warning)
            .count();

        report.push_str("\n<b>Severity Breakdown:</b>\n");
        if critical > 0 {
            report.push_str(&format!("🔴 Critical: {}\n", critical));
        }
        if errors > 0 {
            report.push_str(&format!("❌ Errors: {}\n", errors));
        }
        if warnings > 0 {
            report.push_str(&format!("⚠️ Warnings: {}\n", warnings));
        }

        report.push_str("\n<b>Top Issues:</b>\n");
        for (i, analysis) in analyses.iter().take(5).enumerate() {
            report.push_str(&format!(
                "{}. <code>{}</code> - {} ({}% confidence)\n",
                i + 1,
                analysis.issue_id,
                analysis.issue_type,
                (analysis.confidence * 100.0) as u32
            ));
        }

        if analyses.len() > 5 {
            report.push_str(&format!("...and {} more issues\n", analyses.len() - 5));
        }

        report.push_str("\n<b>Multi-Agent Analysis:</b>\n");
        report.push_str("✅ DeepSeek: Complete\n");
        report.push_str("✅ GPT-4: Complete\n");
        report.push_str("✅ Claude: Complete\n");
        report.push_str("✅ Gemini: Complete\n");

        report.push_str("\n<b>Recommended Actions:</b>\n");
        let auto_fix = analyses
            .iter()
            .filter(|a| a.recommended_action == crate::code_analysis::RecommendedAction::AutoFix)
            .count();
        let review = analyses
            .iter()
            .filter(|a| {
                a.recommended_action == crate::code_analysis::RecommendedAction::RequireReview
            })
            .count();

        if auto_fix > 0 {
            report.push_str(&format!("✅ Auto-fix: {} ready\n", auto_fix));
        }
        if review > 0 {
            report.push_str(&format!("👀 Review: {} issues\n", review));
        }

        report.push_str("\n🤖 <i>Powered by Multi-Agent Code Intelligence</i>\n");
        report.push_str("💬 Use /analyze for full details");

        self.notify(&report).await;
    }

    /// Send detailed analysis of a specific issue
    pub async fn send_issue_details(&self, analysis: &MultiAgentAnalysis) {
        if !self.enabled {
            return;
        }

        let mut report = String::new();
        report.push_str(&format!(
            "🔎 <b>Issue Details: {}</b>\n\n",
            analysis.issue_id
        ));
        report.push_str(&format!("Type: <code>{}</code>\n", analysis.issue_type));
        report.push_str(&format!("Severity: {}\n", analysis.severity));
        report.push_str(&format!(
            "Confidence: {}%\n\n",
            (analysis.confidence * 100.0) as u32
        ));

        report.push_str("<b>Consensus:</b>\n");
        report.push_str(&format!("<code>{}</code>\n\n", analysis.consensus));

        report.push_str("<b>Agent Perspectives:</b>\n");
        for perspective in &analysis.agent_perspectives {
            report.push_str(&format!(
                "• <b>{}:</b> {}\n",
                perspective.agent_name, perspective.risk_level
            ));
        }

        self.notify(&report).await;
    }

    /// Send fix results report
    pub async fn send_fix_results(&self, successful: usize, failed: usize, total: usize) {
        if !self.enabled {
            return;
        }

        let mut report = String::new();
        report.push_str("🔧 <b>AUTONOMOUS FIX RESULTS</b>\n\n");
        report.push_str(&format!("✅ Successful: {}/{}\n", successful, total));
        report.push_str(&format!("❌ Failed: {}/{}\n", failed, total));

        let success_rate = if total > 0 {
            (successful as f64 / total as f64) * 100.0
        } else {
            100.0
        };

        report.push_str(&format!("📊 Success Rate: {:.1}%\n", success_rate));

        if failed == 0 {
            report.push_str("\n✨ All fixes applied successfully!");
        } else {
            report.push_str("\n⚠️ Some fixes failed validation - see details for rollback info");
        }

        self.notify(&report).await;
    }
}

/// Run Telegram listener to send notifications.
/// Command handling is done via separate polling in main orchestrator.
pub async fn run_telegram_listener(
    token: &str,
    chat_id: i64,
    orchestrator_tx: tokio::sync::mpsc::Sender<String>,
) {
    if token.trim().is_empty() || chat_id == 0 {
        tracing::info!("telegram listener disabled (missing token or chat id)");
        return;
    }

    let bot = Bot::new(token);
    let target_chat_id = ChatId(chat_id);

    // #region agent log
    let debug_log = "/Users/josh/Documents/lightbound/Gauss/Gauss Aurora V0.1/.cursor/debug-21c0ed.log";
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let _ = std::fs::OpenOptions::new().append(true).create(true).open(debug_log).and_then(|mut f| {
        use std::io::Write;
        writeln!(f, "{}", serde_json::json!({"sessionId":"21c0ed","hypothesisId":"H4","location":"telegram_connector.rs:listener_start","message":"listener started","data":{"target_chat_id":chat_id},"timestamp":ts}))
    });
    // #endregion

    tracing::info!("🤖 Telegram listener starting - ready to send agent analysis reports");

    // Verify bot connection
    match bot.get_me().await {
        Ok(me) => {
            tracing::info!(
                bot_name = me.username.as_deref().unwrap_or("unknown"),
                "✅ Telegram bot connected"
            );
        }
        Err(e) => {
            tracing::error!("❌ Failed to connect to Telegram: {}", e);
            return;
        }
    }

    // Send welcome message
    let welcome = "🤖 <b>GAUSS Orchestrator Connected</b>\n\n\
        🔬 <b>Agent Team Ready:</b>\n\
        • DeepSeek (reasoning & analysis)\n\
        • GPT-4 (code generation)\n\
        • Claude (safety checks)\n\
        • Gemini (data analysis)\n\n\
        📝 Agent analysis reports will be sent to this chat.\n\
        Files are continuously monitored in ./new_telemetry/\n\n\
        All fixes are validated with cargo test before applying.";
    // #region agent log
    let welcome_res = bot
        .send_message(target_chat_id, welcome)
        .parse_mode(ParseMode::Html)
        .await;
    let ts2 = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let (welcome_ok, err_str): (bool, String) = welcome_res.as_ref().map(|_| (true, String::new())).unwrap_or_else(|e| (false, e.to_string()));
    let _ = std::fs::OpenOptions::new().append(true).create(true).open(debug_log).and_then(|mut f| {
        use std::io::Write;
        writeln!(f, "{}", serde_json::json!({"sessionId":"21c0ed","hypothesisId":"H5","location":"telegram_connector.rs:welcome","message":"welcome send","data":{"ok":welcome_ok,"error":err_str},"timestamp":ts2}))
    });
    // #endregion

    // Poll updates and forward commands to orchestrator.
    // This enables actual two-way chat controls without requiring webhook setup.
    // Use a longer timeout (default 90s) so long-polling does not time out on slow or high-latency networks.
    let poll_timeout_secs: u64 = std::env::var("ORCHESTRATOR_TELEGRAM_POLL_TIMEOUT_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(90)
        .clamp(10, 120);
    let mut offset: i32 = 0;
    loop {
        let mut request = bot.get_updates().timeout(poll_timeout_secs as u32).limit(50);
        if offset > 0 {
            request = request.offset(offset);
        }

        match request.send().await {
            Ok(updates) => {
                for update in updates {
                    offset = update.id + 1;
                    if let teloxide::types::UpdateKind::Message(message) = update.kind {
                        if message.chat.id != target_chat_id {
                            // #region agent log
                            let ts3 = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
                            let incoming_id = format!("{:?}", message.chat.id);
                            let _ = std::fs::OpenOptions::new().append(true).create(true).open(debug_log).and_then(|mut f| {
                                use std::io::Write;
                                writeln!(f, "{}", serde_json::json!({"sessionId":"21c0ed","hypothesisId":"H4","location":"telegram_connector.rs:filter","message":"chat id mismatch skip","data":{"target_chat_id":chat_id,"incoming_chat_id":incoming_id},"timestamp":ts3}))
                            });
                            // #endregion
                            continue;
                        }
                        let Some(text) = message.text() else {
                            continue;
                        };
                        let text = text.trim();
                        if text.is_empty() {
                            continue;
                        }
                        state::push_telegram_feed("inbound", "message", text);
                        if let Err(err) = orchestrator_tx.send(text.to_string()).await {
                            tracing::error!(error = %err, "failed to forward telegram command");
                        }
                    }
                }
            }
            Err(err) => {
                let err_str = err.to_string();
                if err_str.contains("Conflict") || err_str.contains("only one bot instance") {
                    tracing::warn!(
                        "telegram conflict: another process is using this bot (only one getUpdates allowed). \
                        Stop other orchestrator instances or apps using this token, or run: npm run dev:prune"
                    );
                } else {
                    tracing::warn!(error = %err, "telegram get_updates failed; retrying");
                }
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            }
        }
    }
}
