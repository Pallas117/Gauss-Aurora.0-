//! HTTP API for SSA fusion: POST /ssa/measurements (validate + associate), GET /ssa/tracks.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Serialize;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::ssa::{AssociationDiagnostic, AssociationEngine, MeasurementBatch, TrackState};

#[derive(Clone)]
pub struct SsaApiState {
    pub engine: Arc<RwLock<AssociationEngine>>,
}

#[derive(Debug, Serialize)]
struct MeasurementsResponse {
    accepted: bool,
    diagnostics: Vec<AssociationDiagnostic>,
    tracks: Vec<TrackState>,
    validation_error: Option<String>,
}

pub fn router(state: SsaApiState) -> Router {
    Router::new()
        .route("/ssa/measurements", post(post_measurements))
        .route("/ssa/tracks", get(get_tracks))
        .with_state(state)
}

pub async fn serve(bind_addr: &str, state: SsaApiState) -> anyhow::Result<()> {
    use anyhow::Context;
    let addr: std::net::SocketAddr = bind_addr
        .parse()
        .with_context(|| format!("invalid ORCHESTRATOR_SSA_API_BIND address: {}", bind_addr))?;
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("failed binding SSA API listener on {}", bind_addr))?;
    tracing::info!(
        bind_addr = %bind_addr,
        "SSA API listening on POST /ssa/measurements, GET /ssa/tracks"
    );
    axum::serve(listener, router(state))
        .await
        .context("SSA API server exited unexpectedly")?;
    Ok(())
}

async fn post_measurements(
    State(state): State<SsaApiState>,
    Json(batch): Json<MeasurementBatch>,
) -> impl IntoResponse {
    if let Err(e) = batch.validate() {
        return (
            StatusCode::BAD_REQUEST,
            Json(MeasurementsResponse {
                accepted: false,
                diagnostics: vec![],
                tracks: vec![],
                validation_error: Some(format!("{}: {}", e.field, e.message)),
            }),
        )
            .into_response();
    }
    let mut engine = state.engine.write().await;
    let (diagnostics, tracks) = engine.update(&batch);
    (
        StatusCode::OK,
        Json(MeasurementsResponse {
            accepted: true,
            diagnostics,
            tracks,
            validation_error: None,
        }),
    )
        .into_response()
}

async fn get_tracks(State(state): State<SsaApiState>) -> impl IntoResponse {
    let engine = state.engine.read().await;
    let tracks = engine.tracks();
    (StatusCode::OK, Json(tracks)).into_response()
}
