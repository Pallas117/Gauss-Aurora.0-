//! Optional Slack notification sink for local objective automation.
//!
//! This is deliberately notification-only. The webhook is never logged, Slack
//! cannot approve work, and messages are bounded and redacted before egress.

use reqwest::Client;
use serde::Serialize;
use std::time::Duration;

const DEFAULT_MAX_MESSAGE_BYTES: usize = 3_000;

#[derive(Clone)]
pub struct SlackConnector {
    client: Client,
    webhook_url: String,
    max_message_bytes: usize,
}

#[derive(Serialize)]
struct SlackPayload<'a> {
    text: &'a str,
}

impl SlackConnector {
    /// Enable only when explicitly requested and the webhook is an HTTPS Slack endpoint.
    pub fn from_env() -> Option<Self> {
        let enabled = std::env::var("ORCHESTRATOR_SLACK_NOTIFICATIONS_ENABLED")
            .ok()
            .map(|value| {
                !matches!(
                    value.trim().to_ascii_lowercase().as_str(),
                    "0" | "false" | "off" | "no" | "disabled"
                )
            })
            .unwrap_or(false);
        if !enabled {
            return None;
        }

        let webhook_url = std::env::var("ORCHESTRATOR_SLACK_WEBHOOK_URL").ok()?;
        let parsed = reqwest::Url::parse(webhook_url.trim()).ok()?;
        if parsed.scheme() != "https" || parsed.host_str()? != "hooks.slack.com" {
            tracing::warn!(
                "Slack notifications disabled: webhook must use https://hooks.slack.com"
            );
            return None;
        }

        let max_message_bytes = std::env::var("ORCHESTRATOR_SLACK_MAX_MESSAGE_BYTES")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(DEFAULT_MAX_MESSAGE_BYTES)
            .clamp(256, 4_000);
        let client = Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(5))
            .build()
            .ok()?;

        Some(Self {
            client,
            webhook_url: webhook_url.trim().to_string(),
            max_message_bytes,
        })
    }

    pub async fn notify(&self, message: &str) -> Result<(), String> {
        let bounded = truncate_utf8(&redact(message), self.max_message_bytes);
        self.client
            .post(&self.webhook_url)
            .json(&SlackPayload { text: &bounded })
            .send()
            .await
            .map_err(|error| format!("Slack notification request failed: {error}"))?
            .error_for_status()
            .map_err(|error| format!("Slack notification rejected: {error}"))?;
        Ok(())
    }
}

fn redact(message: &str) -> String {
    message
        .replace("ORCHESTRATOR_SLACK_WEBHOOK_URL", "[slack-webhook]")
        .replace("TELEGRAM_BOT_TOKEN", "[telegram-token]")
        .replace("DEEPSEEK_API_KEY", "[model-key]")
        .replace("SUPABASE_SERVICE_ROLE_KEY", "[supabase-service-key]")
}

fn truncate_utf8(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let suffix = "…[truncated]";
    if max_bytes <= suffix.len() {
        let mut end = max_bytes;
        while end > 0 && !value.is_char_boundary(end) {
            end -= 1;
        }
        return value[..end].to_string();
    }
    let mut end = max_bytes - suffix.len();
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}{}", &value[..end], suffix)
}

#[cfg(test)]
mod tests {
    use super::truncate_utf8;

    #[test]
    fn truncation_preserves_utf8_and_bounds_messages() {
        let output = truncate_utf8("🛰️ hello world — objective cycle completed safely", 32);
        assert!(output.len() <= 32);
        assert!(output.ends_with("…[truncated]"));
    }
}
