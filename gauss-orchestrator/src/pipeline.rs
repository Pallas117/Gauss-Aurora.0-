//! Triad pipeline: Rust-native Surya→DeepSeek or backend API trigger; cloud export.
//! Prefer run_triad_native (no Python/backend) when triad_on_csv; optional trigger_triad for backend.

use crate::anonymization;
use crate::config::OrchestratorConfig;
use reqwest::Client;
use serde_json::json;
use std::path::Path;
use std::time::Duration;

/// Run triad entirely in Rust: Surya step (HTTP or stub) then DeepSeek (local engine).
/// Returns report JSON string compatible with export_scrubbed_to_cloud_and_save.
pub async fn run_triad_native(
    client: &Client,
    source_path: &Path,
    config: &OrchestratorConfig,
) -> Result<String, String> {
    let surya = run_surya_step(client, source_path, config).await?;
    let deepseek = run_deepseek_step(client, source_path, &surya, config).await?;
    let timestamp = chrono::Utc::now().to_rfc3339().replace("+00:00", "Z");
    let summary = deepseek
        .get("recommendation")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let report = json!({
        "timestamp": timestamp,
        "surya": surya,
        "deepseek": deepseek,
        "summary": summary
    });
    serde_json::to_string(&report).map_err(|e| e.to_string())
}

async fn run_surya_step(
    client: &Client,
    source_path: &Path,
    config: &OrchestratorConfig,
) -> Result<serde_json::Value, String> {
    let path_str = source_path
        .to_path_buf()
        .into_os_string()
        .into_string()
        .map_err(|_| "invalid path")?;
    let source_size_bytes = std::fs::metadata(source_path)
        .map(|m| m.len())
        .unwrap_or(0);

    if let Some(ref base) = config.surya_service_url {
        let url = format!("{}/surya/forecast", base.trim_end_matches('/'));
        let timeout = Duration::from_secs(15);
        let res = client
            .post(&url)
            .json(&serde_json::json!({}))
            .timeout(timeout)
            .send()
            .await
            .map_err(|e| format!("surya request failed: {}", e))?;
        let status = res.status();
        let body = res
            .text()
            .await
            .map_err(|e| format!("surya body read failed: {}", e))?;
        if status.is_success() {
            let data: serde_json::Value = serde_json::from_str(&body).unwrap_or(json!({}));
            let default_forecast = json!([{"time": "now", "value": 0.0}]);
            return Ok(json!({
                "worker": "surya",
                "model": data.get("model").and_then(|v| v.as_str()).unwrap_or("surya.366m.v1"),
                "forecast": data.get("forecast").unwrap_or(&default_forecast),
                "source_path": path_str,
                "source_size_bytes": source_size_bytes,
                "stub": false
            }));
        }
    }

    Ok(json!({
        "worker": "surya",
        "model": "surya.366m.v1",
        "forecast": [{"time": "now", "value": 0.0}],
        "source_path": path_str,
        "source_size_bytes": source_size_bytes,
        "stub": true
    }))
}

async fn run_deepseek_step(
    client: &Client,
    source_path: &Path,
    surya_output: &serde_json::Value,
    config: &OrchestratorConfig,
) -> Result<serde_json::Value, String> {
    let path_str = source_path
        .to_path_buf()
        .into_os_string()
        .into_string()
        .map_err(|_| "invalid path")?;
    let surya_ctx = serde_json::to_string(surya_output).unwrap_or_default();
    let surya_ctx = surya_ctx.chars().take(500).collect::<String>();
    let prompt = format!(
        "You are the Gauss space-ops co-pilot. Your recommendation must follow spacecraft operations norms and probability-based reasoning: use only NOMINAL, MONITOR, or INITIATE SHIELDING, with a brief rationale. Reason ethically: prioritize crew and asset safety; treat Earth and its fields as one system; state uncertainty when present; be transparent; align with equitable, sustainable, data-backed outcomes. Communicate in a calm, precise, mission-focused voice; you are a partner to the human operator in a system built to save lives and enable an equitable, sustainable space future. Base your answer on the physics/telemetry context below.\n\nContext: {}\nCSV path: {}\n\nProvide a brief mission assessment (2-4 sentences). Output: one of NOMINAL / MONITOR / INITIATE SHIELDING and one-line rationale. When uncertain, say so and suggest what would clarify (e.g. additional telemetry or time window).",
        surya_ctx, path_str
    );
    let payload = json!({
        "model": config.local_engine_model,
        "messages": [{ "role": "user", "content": prompt }],
        "max_tokens": 300
    });
    let timeout = Duration::from_secs(config.http_timeout_seconds.saturating_mul(2).max(30));
    let mut req = client
        .post(&config.local_engine_url)
        .json(&payload)
        .timeout(timeout);
    if let Some(ref key) = config.local_engine_api_key {
        req = req.bearer_auth(key);
    }
    let res = req.send().await.map_err(|e| format!("deepseek request failed: {}", e))?;
    let status = res.status();
    let body = res
        .text()
        .await
        .map_err(|e| format!("deepseek body read failed: {}", e))?;
    if !status.is_success() {
        return Ok(json!({
            "worker": "deepseek",
            "recommendation": "UNAVAILABLE (local engine not reachable)",
            "reasoning": body.chars().take(500).collect::<String>(),
            "stub": true
        }));
    }
    let content: String = serde_json::from_str(&body)
        .ok()
        .and_then(|j: serde_json::Value| {
            j.get("choices")?
                .get(0)?
                .get("message")?
                .get("content")?
                .as_str()
                .map(String::from)
        })
        .unwrap_or_default();
    let recommendation = content.chars().take(200).collect::<String>();
    Ok(json!({
        "worker": "deepseek",
        "recommendation": recommendation,
        "reasoning": content,
        "stub": false
    }))
}

/// Trigger the triad pipeline (Worker A Surya → Worker B DeepSeek) via backend direct API.
/// Returns the raw report JSON from the backend, or error string.
pub async fn trigger_triad(
    client: &Client,
    source_path: &Path,
    config: &OrchestratorConfig,
) -> Result<String, String> {
    let base = config
        .pipeline_api_url
        .as_deref()
        .ok_or("pipeline_api_url not set")?;
    let url = format!("{}/api/ops/pipeline/triad", base.trim_end_matches('/'));
    let path_str = source_path
        .to_path_buf()
        .into_os_string()
        .into_string()
        .map_err(|_| "invalid path")?;

    let body = serde_json::json!({ "sourcePath": path_str });
    let timeout = Duration::from_secs(config.http_timeout_seconds.saturating_mul(2).max(60));

    let res = client
        .post(&url)
        .json(&body)
        .timeout(timeout)
        .send()
        .await
        .map_err(|e| format!("triad trigger request failed: {}", e))?;

    let status = res.status();
    let text = res
        .text()
        .await
        .map_err(|e| format!("triad response body read failed: {}", e))?;

    if !status.is_success() {
        return Err(format!("triad pipeline returned {}: {}", status, &text[..text.len().min(256)]));
    }
    Ok(text)
}

/// Sovereign Buffer + optional Daily Mission Summary. No egress by default: uses local engine only.
/// Set ORCHESTRATOR_DAILY_SUMMARY_USE_LOCAL=false and OPENAI_API_KEY to allow cloud summary.
pub async fn export_scrubbed_to_cloud_and_save(
    client: &Client,
    report_json: &str,
    config: &OrchestratorConfig,
) -> Result<(), String> {
    let scrubbed = anonymization::anonymize_payload(report_json);

    let prompt_content = format!(
        "Based on this scrubbed mission report, write a brief Daily Mission Summary (3-5 sentences, unclassified):\n\n{}",
        scrubbed
    );
    let payload = serde_json::json!({
        "model": config.local_engine_model,
        "messages": [{ "role": "user", "content": prompt_content }],
        "max_tokens": 500
    });
    let timeout = Duration::from_secs(config.http_timeout_seconds);

    // Default: use local engine only (no egress). MLX/local-first aligned.
    if config.daily_summary_use_local {
        let mut req = client
            .post(&config.local_engine_url)
            .json(&payload)
            .timeout(timeout);
        if let Some(ref key) = config.local_engine_api_key {
            req = req.bearer_auth(key);
        }
        match req.send().await {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    let summary = json
                        .get("choices")
                        .and_then(|c| c.get(0))
                        .and_then(|c| c.get("message"))
                        .and_then(|m| m.get("content"))
                        .and_then(|c| c.as_str())
                        .unwrap_or("(no content)")
                        .to_string();
                    if let Err(e) = save_daily_summary(&summary) {
                        tracing::warn!("failed to write daily summary: {}", e);
                    }
                }
            }
            Ok(resp) => tracing::debug!("local engine daily summary returned {}", resp.status()),
            Err(e) => tracing::warn!("local engine daily summary request failed: {}", e),
        }
        return Ok(());
    }

    // Optional cloud path: only when cloud egress is explicitly enabled and local-only summaries are disabled
    if !config.cloud_enabled {
        return Ok(());
    }

    let api_key = std::env::var("ORCHESTRATOR_OPENAI_API_KEY")
        .or_else(|_| std::env::var("OPENAI_API_KEY"))
        .ok();

    if let Some(key) = api_key {
        let cloud_payload = serde_json::json!({
            "model": "gpt-4o-mini",
            "messages": [{ "role": "user", "content": prompt_content }],
            "max_tokens": 500
        });

        let res = client
            .post("https://api.openai.com/v1/chat/completions")
            .bearer_auth(&key)
            .json(&cloud_payload)
            .timeout(timeout)
            .send()
            .await;

        match res {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    let summary = json
                        .get("choices")
                        .and_then(|c| c.get(0))
                        .and_then(|c| c.get("message"))
                        .and_then(|m| m.get("content"))
                        .and_then(|c| c.as_str())
                        .unwrap_or("(no content)")
                        .to_string();
                    if let Err(e) = save_daily_summary(&summary) {
                        tracing::warn!("failed to write daily summary: {}", e);
                    }
                }
            }
            Ok(resp) => tracing::warn!("cloud LLM returned {}", resp.status()),
            Err(e) => tracing::warn!("cloud export request failed: {}", e),
        }
    }

    Ok(())
}

fn save_daily_summary(summary: &str) -> Result<(), std::io::Error> {
    let dir = std::path::Path::new("reports");
    std::fs::create_dir_all(dir)?;
    let path = dir.join("daily-summary.txt");
    let ts = chrono::Utc::now().to_rfc3339();
    let content = format!("--- Daily Mission Summary ---\n{}\n\nGenerated: {}\n", summary, ts);
    std::fs::write(path, content)
}
