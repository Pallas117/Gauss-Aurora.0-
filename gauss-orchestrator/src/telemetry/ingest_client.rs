use anyhow::{bail, Context};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::pin::Pin;

use crate::config::OrchestratorConfig;
use crate::telemetry::MappedCanonicalPacket;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PacketIngestRequest {
    pub run_id: String,
    pub source: String,
    pub format: String,
    pub dictionary_id: String,
    pub packets: Vec<MappedCanonicalPacket>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PacketIngestError {
    pub index: usize,
    pub code: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PacketIngestResponse {
    pub accepted_count: usize,
    pub rejected_count: usize,
    pub errors: Vec<PacketIngestError>,
}

/// Response from POST /api/ingest/telemetry/refine (same packet shape as ingest).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryRefineResponse {
    pub packets: Vec<MappedCanonicalPacket>,
    pub clamped_count: usize,
    pub interpolated_count: usize,
}

const BODY_PREVIEW_LEN: usize = 500;

/// Failure from a single ingest attempt: connection/network or HTTP status + body.
#[derive(Debug)]
pub enum IngestAttemptError {
    Connection(String),
    Http { status: u16, body: String },
}

/// Single attempt: build request, send, return response or error with status and body for logging and fix logic.
async fn post_ingest_packets_once(
    client: &Client,
    config: &OrchestratorConfig,
    request: &PacketIngestRequest,
) -> Result<PacketIngestResponse, IngestAttemptError> {
    let mut req = client.post(&config.ingest_api_url).json(request);
    if let Some(token) = &config.ingest_api_token {
        req = req
            .header("Authorization", format!("Bearer {}", token))
            .header("x-gauss-service-token", token);
    }

    let response = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            return Err(IngestAttemptError::Connection(e.to_string()));
        }
    };
    let status = response.status().as_u16();
    let body = response.text().await.unwrap_or_else(|_| String::new());

    if !(200..300).contains(&status) {
        return Err(IngestAttemptError::Http {
            status,
            body: body.clone(),
        });
    }

    serde_json::from_str(&body).map_err(|e| IngestAttemptError::Http {
        status: 200,
        body: format!("parse error: {}; body: {}", e, body),
    })
}

/// Combine two ingest responses (for 413 split retry).
fn combine_responses(a: PacketIngestResponse, b: PacketIngestResponse) -> PacketIngestResponse {
    let mut errors = a.errors;
    let offset = errors.len();
    errors.extend(b.errors.into_iter().map(|e| PacketIngestError {
        index: e.index + offset,
        code: e.code,
        reason: e.reason,
    }));
    PacketIngestResponse {
        accepted_count: a.accepted_count + b.accepted_count,
        rejected_count: a.rejected_count + b.rejected_count,
        errors,
    }
}

/// Post packet ingest with retries. On failure: log status and body (look at logs), then apply fix
/// before retry: on 413 with multiple packets, split batch and retry each half; on 5xx or network
/// error, exponential backoff and retry. Integrates fixes from previous testing (exponential backoff,
/// batch split on payload too large).
/// Returns a boxed future to allow recursive calls on 413 split without infinitely sized future.
pub fn post_ingest_packets<'a>(
    client: &'a Client,
    config: &'a OrchestratorConfig,
    request: &'a PacketIngestRequest,
) -> Pin<Box<dyn Future<Output = anyhow::Result<PacketIngestResponse>> + Send + 'a>> {
    Box::pin(post_ingest_packets_impl(client, config, request))
}

async fn post_ingest_packets_impl(
    client: &Client,
    config: &OrchestratorConfig,
    request: &PacketIngestRequest,
) -> anyhow::Result<PacketIngestResponse> {
    let max_attempts = config.ingest_retry_count.saturating_add(1);

    for attempt in 0..max_attempts {
        match post_ingest_packets_once(client, config, request).await {
            Ok(resp) => return Ok(resp),
            Err(IngestAttemptError::Http { status, body }) => {
                let body_preview = if body.len() > BODY_PREVIEW_LEN {
                    format!("{}...", &body[..BODY_PREVIEW_LEN])
                } else {
                    body.clone()
                };
                tracing::warn!(
                    attempt = attempt + 1,
                    max_attempts = max_attempts,
                    status = status,
                    body_preview = %body_preview,
                    "ingest POST failed (look at logs before retry)"
                );

                if status == 413 && request.packets.len() > 1 {
                    let mid = request.packets.len() / 2;
                    let (left, right) = request.packets.split_at(mid);
                    let req_left = PacketIngestRequest {
                        packets: left.to_vec(),
                        ..request.clone()
                    };
                    let req_right = PacketIngestRequest {
                        packets: right.to_vec(),
                        ..request.clone()
                    };
                    let resp_left = post_ingest_packets(client, config, &req_left).await?;
                    let resp_right = post_ingest_packets(client, config, &req_right).await?;
                    return Ok(combine_responses(resp_left, resp_right));
                }

                if status >= 500 && attempt + 1 < max_attempts {
                    let backoff_ms = config.ingest_retry_backoff_ms * (1 << attempt);
                    tracing::warn!(
                        attempt = attempt + 1,
                        backoff_ms = backoff_ms,
                        "retrying after backoff (fix from previous testing: exponential backoff)"
                    );
                    tokio::time::sleep(tokio::time::Duration::from_millis(backoff_ms)).await;
                    continue;
                }

                bail!("packet ingest API returned {}: {}", status, body);
            }
            Err(IngestAttemptError::Connection(ref msg)) => {
                tracing::warn!(
                    attempt = attempt + 1,
                    max_attempts = max_attempts,
                    error = %msg,
                    "ingest POST connection failed (look at logs before retry)"
                );
                if attempt + 1 < max_attempts {
                    let backoff_ms = config.ingest_retry_backoff_ms * (1 << attempt);
                    tracing::warn!(
                        attempt = attempt + 1,
                        backoff_ms = backoff_ms,
                        "retrying after backoff"
                    );
                    tokio::time::sleep(tokio::time::Duration::from_millis(backoff_ms)).await;
                    continue;
                }
                bail!("failed to post packet ingest payload: {}", msg);
            }
        }
    }

    unreachable!()
}

/// POST batch to refinement endpoint; returns refined packets for ingest.
pub async fn post_refine_packets(
    client: &Client,
    refine_url: &str,
    token: Option<&str>,
    request: &PacketIngestRequest,
) -> anyhow::Result<TelemetryRefineResponse> {
    let mut req = client.post(refine_url).json(request);
    if let Some(t) = token {
        req = req
            .header("Authorization", format!("Bearer {}", t))
            .header("x-gauss-service-token", t);
    }

    let response = req
        .send()
        .await
        .context("failed to post telemetry refine payload")?;
    let status = response.status();
    if !status.is_success() {
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "<no response body>".to_string());
        bail!("telemetry refine API returned {}: {}", status, body);
    }

    response
        .json::<TelemetryRefineResponse>()
        .await
        .context("failed to parse telemetry refine API response")
}
