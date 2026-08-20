use crate::config::OrchestratorConfig;
use crate::model_governance::governed_prompt;
use crate::types::{RoutingDecision, RoutingTarget};
use reqwest::Client;
use serde_json::json;
use std::time::Duration;

/// Operator (DeepSeek) system prompt: frame the model as the mission decision-maker we are training.
pub async fn route_to_local(
    client: &Client,
    data: &str,
    config: &OrchestratorConfig,
) -> Result<RoutingDecision, reqwest::Error> {
    let operator_system_prompt = governed_prompt(
        "You are the Gauss mission operator (decision-maker). Use spacecraft operations procedures and probability-based reasoning. Reason ethically: prioritize crew and asset safety; treat Earth and its fields as one system; state uncertainty when present; be transparent; align with equitable, sustainable, data-backed outcomes. Communicate in a calm, precise, mission-focused voice; you are a partner to the human operator in a system built to save lives and enable an equitable, sustainable space future.",
        &[
            "Respond with exactly one of: NOMINAL, MONITOR, or INITIATE SHIELDING, then a one-line rationale.",
            "When uncertain, say so and suggest what would clarify (e.g. additional telemetry or time window).",
        ],
    );
    let user_content = format!(
        "As the mission operator, review this telemetry and state your decision (NOMINAL / MONITOR / INITIATE SHIELDING) and one-line rationale.\n\nTelemetry:\n{}",
        data
    );
    let payload = json!({
        "model": config.local_engine_model,
        "messages": [
            { "role": "system", "content": operator_system_prompt },
            { "role": "user", "content": user_content }
        ],
        "temperature": 0.3,
        "max_tokens": 500
    });

    let timeout = Duration::from_secs(config.http_timeout_seconds);
    let mut request = client
        .post(&config.local_engine_url)
        .json(&payload)
        .timeout(timeout);

    if let Some(api_key) = &config.local_engine_api_key {
        request = request.bearer_auth(api_key);
    }

    let res = request.send().await?;

    let status = res.status();
    let body = res
        .text()
        .await
        .unwrap_or_else(|_| "<failed to read>".to_string());

    let operator_decision = if status.is_success() {
        parse_operator_decision_from_response(&body)
    } else {
        tracing::warn!(status = %status, body = %truncate(&body, 512), "local-inference (DeepSeek operator) failed");
        None
    };

    if status.is_success() {
        tracing::info!(
            status = %status,
            decision = ?operator_decision.as_deref().map(|s| truncate(s, 80)),
            "local-inference (DeepSeek as operator) complete"
        );
    }

    Ok(RoutingDecision {
        target: RoutingTarget::Local,
        reason:
            "High-sensitivity content routed to local DeepSeek engine (operator/decision-maker)"
                .to_string(),
        anonymized: false,
        operator_decision,
    })
}

fn parse_operator_decision_from_response(body: &str) -> Option<String> {
    let json: serde_json::Value = serde_json::from_str(body).ok()?;
    let content = json
        .get("choices")?
        .get(0)?
        .get("message")?
        .get("content")?
        .as_str()?
        .trim();
    if content.is_empty() {
        None
    } else {
        Some(content.to_string())
    }
}

pub async fn route_to_cloud(
    client: &Client,
    data: &str,
    config: &OrchestratorConfig,
) -> Result<RoutingDecision, anyhow::Error> {
    if !config.cloud_enabled {
        tracing::info!("cloud routing disabled; sending LOW/UNKNOWN to local engine");
        let anonymized = crate::anonymization::anonymize_telemetry(data);
        let decision = route_to_local(client, &anonymized, config)
            .await
            .map_err(anyhow::Error::from)?;
        return Ok(RoutingDecision {
            target: decision.target,
            reason: "Cloud disabled; LOW/UNKNOWN content anonymized and sent to local engine (DeepSeek as operator)".to_string(),
            anonymized: true,
            operator_decision: decision.operator_decision,
        });
    }

    let _anonymized = crate::anonymization::anonymize_telemetry(data);
    tracing::info!("data anonymized and ready for cloud analysis");

    // Cloud provider integration: OpenAI (when OPENAI_API_KEY or ORCHESTRATOR_OPENAI_API_KEY is set)
    let api_key = std::env::var("ORCHESTRATOR_OPENAI_API_KEY")
        .or_else(|_| std::env::var("OPENAI_API_KEY"))
        .ok();

    if let Some(key) = api_key {
        let payload = json!({
            "model": "gpt-4",
            "messages": [
                {"role": "user", "content": format!("Analyze anonymized telemetry:\n{}", _anonymized)}
            ],
            "max_tokens": 800
        });

        let timeout = Duration::from_secs(config.http_timeout_seconds);
        let res = client
            .post("https://api.openai.com/v1/chat/completions")
            .bearer_auth(key)
            .json(&payload)
            .timeout(timeout)
            .send()
            .await;

        match res {
            Ok(resp) => {
                let status = resp.status();
                let txt = resp
                    .text()
                    .await
                    .unwrap_or_else(|_| "<failed to read body>".to_string());
                tracing::info!(status = %status, body = %truncate(&txt, 1024), "cloud provider response");
            }
            Err(e) => {
                tracing::warn!(error = %e, "cloud provider request failed; proceeding without cloud result");
            }
        }
    } else {
        tracing::info!("no OPENAI_API_KEY configured; skipping remote cloud call (only anonymization performed)");
    }

    Ok(RoutingDecision {
        target: RoutingTarget::Cloud,
        reason: "Low-sensitivity content anonymized and queued for cloud analysis".to_string(),
        anonymized: true,
        operator_decision: None,
    })
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...<truncated>", &s[..max])
    }
}
