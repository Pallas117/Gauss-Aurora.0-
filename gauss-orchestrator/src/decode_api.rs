//! HTTP API for decode and pipeline. POST /telemetry/decode; POST /pipeline/triad (Rust-native triad).

use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::post;
use axum::{Json, Router};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use serde::Deserialize;
use std::path::Path;
use std::sync::Arc;
use tracing::warn;

use crate::config::OrchestratorConfig;
use crate::pipeline;
use crate::telemetry::decode_and_map_packets;
use crate::telemetry::decoder_registry::DecoderFormat;

#[derive(Debug, Deserialize)]
struct DecodeRequestBody {
    #[serde(default)]
    format: String,
    /// Base64-encoded packet bytes (when format is JSON).
    payload: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TriadRequestBody {
    #[serde(alias = "sourcePath")]
    source_path: String,
}

pub fn router(config: Arc<OrchestratorConfig>) -> Router {
    Router::new()
        .route("/telemetry/decode", post(decode_handler))
        .route("/pipeline/triad", post(triad_handler))
        .with_state(config)
}

pub async fn serve(bind_addr: &str, config: Arc<OrchestratorConfig>) -> anyhow::Result<()> {
    use anyhow::Context;
    let addr: std::net::SocketAddr = bind_addr.parse().with_context(|| {
        format!(
            "invalid ORCHESTRATOR_DECODE_API_BIND address: {}",
            bind_addr
        )
    })?;
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("failed binding decode API listener on {}", bind_addr))?;
    tracing::info!(bind_addr = %bind_addr, "decode API listening on POST /telemetry/decode, POST /pipeline/triad");
    axum::serve(listener, router(config))
        .await
        .context("decode API server exited unexpectedly")?;
    Ok(())
}

async fn decode_handler(
    State(config): State<Arc<OrchestratorConfig>>,
    body: Bytes,
) -> impl IntoResponse {
    let (format, bytes): (DecoderFormat, Vec<u8>) = match body.first().copied() {
        Some(b'{') => {
            let json: DecodeRequestBody = match serde_json::from_slice(&body) {
                Ok(j) => j,
                Err(e) => return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({ "error": "invalid_json", "message": e.to_string() })),
                )
                    .into_response(),
            };
            let format = match json.format.to_lowercase().as_str() {
                "ccsds-hex" => DecoderFormat::CcsdsHex,
                _ => DecoderFormat::CcsdsBin,
            };
            let payload = json.payload.unwrap_or_default();
            let bytes = match BASE64_STANDARD.decode(payload.trim()) {
                Ok(b) => b,
                Err(e) => return (
                    StatusCode::BAD_REQUEST,
                    Json(
                        serde_json::json!({ "error": "invalid_base64", "message": e.to_string() }),
                    ),
                )
                    .into_response(),
            };
            (format, bytes)
        }
        _ => (DecoderFormat::CcsdsBin, body.to_vec()),
    };

    match decode_and_map_packets(&bytes, format, &config) {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err(e) => {
            warn!(error = %e, "decode_and_map_packets failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "decode_failed", "message": e.to_string() })),
            )
                .into_response()
        }
    }
}

async fn triad_handler(
    State(config): State<Arc<OrchestratorConfig>>,
    Json(body): Json<TriadRequestBody>,
) -> impl IntoResponse {
    let path = Path::new(body.source_path.trim());
    if path.as_os_str().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "source_path required" })),
        )
            .into_response();
    }
    let client = reqwest::Client::new();
    match pipeline::run_triad_native(&client, path, config.as_ref()).await {
        Ok(report_json) => {
            let report: serde_json::Value = serde_json::from_str(&report_json)
                .unwrap_or(serde_json::json!({ "raw": report_json }));
            (StatusCode::OK, Json(report)).into_response()
        }
        Err(e) => {
            warn!(error = %e, "run_triad_native failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "triad_failed", "message": e })),
            )
                .into_response()
        }
    }
}
