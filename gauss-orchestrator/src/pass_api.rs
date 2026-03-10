use crate::network_management::{
    default_network_manager, DtnIslAuditReport, LinkState, NetworkError, NetworkManager,
    TransferPlan, TransferPlanRequest,
};
use crate::{approval_gate, state};
use crate::pass_domain::{
    AntennaAdapter, CommandReceipt, FilePassStore, MockAntennaAdapter, PassScheduler, PassWindow,
    PlanPassRequest, SchedulePassRequest, SchedulerError, WindowSuggestion,
};
use anyhow::Context;
use axum::extract::{Path, Query, State};
use axum::http::{Method, StatusCode};
use axum::middleware::{self, Next};
use axum::routing::{get, post};
use axum::{Json, Router};
use axum::body::Body;
use axum::http::Request;
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, RwLock};
use uuid::Uuid;

const COMMAND_LOG_MAX: usize = 500;
const IDEMPOTENCY_CACHE_MAX: usize = 100;

#[derive(Debug, Clone, Serialize)]
pub struct AuditEntry {
    pub request_id: String,
    pub actor_id: String,
    pub role: String,
    pub timestamp: String,
    pub method: String,
    pub path: String,
    pub status: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_digest: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommandLogEntry {
    pub timestamp: String,
    pub pass_id: String,
    pub antenna_id: String,
    pub command_type: String,
    pub idempotency_key: Option<String>,
    pub receipt: CommandReceipt,
}

#[derive(Clone)]
pub struct PassApiState {
    pub scheduler: PassScheduler,
    pub antenna_adapter: Arc<dyn AntennaAdapter>,
    pub network_manager: NetworkManager,
    pub command_log: Arc<RwLock<Vec<CommandLogEntry>>>,
    pub idempotency_cache: Arc<RwLock<HashMap<String, CommandReceipt>>>,
    pub audit_log: Arc<RwLock<Vec<AuditEntry>>>,
    pub default_role: String,
    pub audit_max_entries: usize,
}

impl PassApiState {
    pub fn new(
        scheduler: PassScheduler,
        antenna_adapter: Arc<dyn AntennaAdapter>,
        network_manager: NetworkManager,
        default_role: String,
        audit_max_entries: usize,
    ) -> Self {
        Self {
            scheduler,
            antenna_adapter,
            network_manager,
            command_log: Arc::new(RwLock::new(Vec::new())),
            idempotency_cache: Arc::new(RwLock::new(HashMap::new())),
            audit_log: Arc::new(RwLock::new(Vec::new())),
            default_role,
            audit_max_entries,
        }
    }

    fn append_audit(&self, entry: AuditEntry) {
        if let Ok(mut log) = self.audit_log.write() {
            log.push(entry);
            let excess = log.len().saturating_sub(self.audit_max_entries);
            if excess > 0 {
                log.drain(0..excess);
            }
        }
    }

    fn append_command_log(
        &self,
        pass_id: &str,
        antenna_id: &str,
        command_type: &str,
        idempotency_key: Option<&str>,
        receipt: &CommandReceipt,
    ) {
        if let Ok(mut log) = self.command_log.write() {
            log.push(CommandLogEntry {
                timestamp: chrono::Utc::now().to_rfc3339(),
                pass_id: pass_id.to_string(),
                antenna_id: antenna_id.to_string(),
                command_type: command_type.to_string(),
                idempotency_key: idempotency_key.map(String::from),
                receipt: receipt.clone(),
            });
            let excess = log.len().saturating_sub(COMMAND_LOG_MAX);
            if excess > 0 {
                log.drain(0..excess);
            }
        }
    }

    fn get_or_insert_receipt(
        &self,
        cache_key: &str,
        pass_id: &str,
        antenna_id: &str,
        command_type: &str,
        idempotency_key: Option<&str>,
        make: impl FnOnce() -> CommandReceipt,
    ) -> CommandReceipt {
        if let Some(_) = idempotency_key {
            if let Ok(cache) = self.idempotency_cache.read() {
                if let Some(r) = cache.get(cache_key) {
                    let receipt = r.clone();
                    self.append_command_log(pass_id, antenna_id, command_type, idempotency_key, &receipt);
                    return receipt;
                }
            }
        }
        let receipt = make();
        if let Some(_) = idempotency_key {
            if let Ok(mut cache) = self.idempotency_cache.write() {
                if cache.len() >= IDEMPOTENCY_CACHE_MAX {
                    let keys: Vec<String> = cache.keys().cloned().take(10).collect();
                    for k in keys {
                        cache.remove(&k);
                    }
                }
                cache.insert(cache_key.to_string(), receipt.clone());
            }
        }
        self.append_command_log(pass_id, antenna_id, command_type, idempotency_key, &receipt);
        receipt
    }
}

#[derive(Debug, Serialize)]
struct ApiError {
    code: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    suggested_alternatives: Option<Vec<WindowSuggestion>>,
}

#[derive(Debug, Deserialize)]
struct PointAntennaRequest {
    az_deg: f64,
    el_deg: f64,
    at: Option<String>,
    idempotency_key: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct TrackPassRequest {
    idempotency_key: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct StopAntennaRequest {
    idempotency_key: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FeedQuery {
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct CommandLogQuery {
    limit: Option<usize>,
    pass_id: Option<String>,
}

fn scheduler_error(err: SchedulerError) -> (StatusCode, Json<ApiError>) {
    let status = match err.code.as_str() {
        "pass_not_found" => StatusCode::NOT_FOUND,
        "window_conflict" | "invalid_window" | "invalid_schedule_window" => StatusCode::CONFLICT,
        "invalid_target" | "invalid_station" | "invalid_aos" | "invalid_los" => {
            StatusCode::BAD_REQUEST
        }
        "invalid_schedule_start" | "invalid_schedule_end" => StatusCode::BAD_REQUEST,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (
        status,
        Json(ApiError {
            code: err.code,
            message: err.message,
            suggested_alternatives: err.suggested_alternatives,
        }),
    )
}

fn network_error(err: NetworkError) -> (StatusCode, Json<ApiError>) {
    let status = match err.code.as_str() {
        "no_route" => StatusCode::CONFLICT,
        "invalid_route_request" | "invalid_payload" | "invalid_link" | "invalid_bandwidth"
        | "invalid_payload_limit" => StatusCode::BAD_REQUEST,
        "store_poisoned" => StatusCode::INTERNAL_SERVER_ERROR,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (
        status,
        Json(ApiError {
            code: err.code,
            message: err.message,
            suggested_alternatives: None,
        }),
    )
}

pub fn default_state() -> PassApiState {
    PassApiState::new(
        PassScheduler::default(),
        Arc::new(MockAntennaAdapter),
        default_network_manager(),
        "operator".to_string(),
        1000,
    )
}

/// Build state with optional file persistence for the pass scheduler. On load error, falls back to in-memory.
pub fn state_with_store(
    store_path: Option<&str>,
    default_role: String,
    audit_max_entries: usize,
) -> PassApiState {
    let scheduler = match store_path {
        Some(path) => PassScheduler::with_store(Arc::new(FilePassStore::new(path)))
            .unwrap_or_else(|e| {
                tracing::warn!(path = %path, error = %e, "pass store load failed, using in-memory");
                PassScheduler::default()
            }),
        None => PassScheduler::default(),
    };
    PassApiState::new(
        scheduler,
        Arc::new(MockAntennaAdapter),
        default_network_manager(),
        default_role,
        audit_max_entries,
    )
}

fn role_allowed(role: &str, method: &Method, path: &str) -> bool {
    let role = role.to_lowercase();
    match role.as_str() {
        "admin" => true,
        "operator" => {
            if method == Method::GET {
                return true;
            }
            if method == Method::POST {
                if path == "/passes/plan" {
                    return true;
                }
                if path.strip_prefix("/passes/").map(|s| s.ends_with("/schedule")).unwrap_or(false) {
                    return true;
                }
            }
            false
        }
        "viewer" => method == Method::GET,
        _ => false,
    }
}

fn is_mutation(method: &Method) -> bool {
    matches!(*method, Method::POST | Method::PUT | Method::PATCH | Method::DELETE)
}

async fn rbac_audit_middleware(
    State(state): State<PassApiState>,
    request: Request<Body>,
    next: Next,
) -> Response {
    let request_id = Uuid::new_v4().to_string();
    let method = request.method().clone();
    let path = request.uri().path().to_string();
    let role = request
        .headers()
        .get("X-Gauss-Role")
        .or_else(|| request.headers().get("X-Pass-API-Role"))
        .and_then(|v| v.to_str().ok())
        .unwrap_or(&state.default_role)
        .to_string();
    let actor_id = request
        .headers()
        .get("X-Actor-Id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("anonymous")
        .to_string();

    if !role_allowed(&role, &method, &path) {
        let status = StatusCode::FORBIDDEN;
        state.append_audit(AuditEntry {
            request_id: request_id.clone(),
            actor_id: actor_id.clone(),
            role: role.clone(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            method: method.to_string(),
            path: path.clone(),
            status: status.as_u16(),
            body_digest: None,
        });
        let mut res = (
            status,
            Json(ApiError {
                code: "forbidden".to_string(),
                message: "insufficient role for this action".to_string(),
                suggested_alternatives: None,
            }),
        )
            .into_response();
        res.headers_mut().insert(
            axum::http::header::HeaderName::from_static("x-request-id"),
            request_id.parse().unwrap(),
        );
        return res;
    }

    let response = next.run(request).await;
    let status = response.status();

    if is_mutation(&method) {
        state.append_audit(AuditEntry {
            request_id: request_id.clone(),
            actor_id,
            role,
            timestamp: chrono::Utc::now().to_rfc3339(),
            method: method.to_string(),
            path,
            status: status.as_u16(),
            body_digest: None,
        });
    }

    let (mut parts, body) = response.into_parts();
    parts.headers.insert(
        axum::http::header::HeaderName::from_static("x-request-id"),
        request_id.parse().unwrap(),
    );
    Response::from_parts(parts, body)
}

#[derive(Debug, Deserialize)]
struct AuditLogQuery {
    limit: Option<usize>,
}

pub fn router(state: PassApiState) -> Router {
    let state_for_layer = state.clone();
    Router::new()
        .route("/health", get(health))
        .route("/passes", get(list_passes))
        .route("/passes/plan", post(plan_pass))
        .route("/passes/:id", get(get_pass))
        .route("/passes/:id/schedule", post(schedule_pass))
        .route("/passes/:id/track/:antenna_id", post(track_pass))
        .route("/antennas/:id/point", post(point_antenna))
        .route("/antennas/:id/stop", post(stop_antenna))
        .route("/antennas/commands", get(antenna_commands_log))
        .route("/network/links", get(list_links))
        .route("/network/links/upsert", post(upsert_link))
        .route("/network/route/plan", post(plan_route))
        .route("/network/audit", get(network_audit))
        .route("/telegram/feed", get(telegram_feed))
        .route("/automation/approvals", get(approvals_feed))
        .route("/audit", get(audit_log))
        .route_layer(middleware::from_fn_with_state(state_for_layer, rbac_audit_middleware))
        .with_state(state)
}

pub async fn serve(bind_addr: &str, state: PassApiState) -> anyhow::Result<()> {
    let addr: SocketAddr = bind_addr
        .parse()
        .with_context(|| format!("invalid ORCHESTRATOR_PASS_API_BIND address: {}", bind_addr))?;
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("failed binding pass API listener on {}", bind_addr))?;
    tracing::info!(bind_addr = %bind_addr, "pass orchestration API listening");
    axum::serve(listener, router(state))
        .await
        .context("pass API server exited unexpectedly")?;
    Ok(())
}

async fn health(State(state): State<PassApiState>) -> Json<serde_json::Value> {
    let scheduler_status = state
        .scheduler
        .list_passes()
        .map(|passes| json!({ "status": "ok", "pass_count": passes.len() }))
        .unwrap_or_else(|_| json!({ "status": "error", "message": "store unavailable" }));
    Json(json!({
        "ok": true,
        "service": "gauss-pass-api",
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "dependencies": {
            "scheduler": scheduler_status,
            "antenna": { "status": "mock" }
        }
    }))
}

async fn list_passes(
    State(state): State<PassApiState>,
) -> Result<Json<Vec<PassWindow>>, (StatusCode, Json<ApiError>)> {
    state
        .scheduler
        .list_passes()
        .map(Json)
        .map_err(scheduler_error)
}

async fn plan_pass(
    State(state): State<PassApiState>,
    Json(req): Json<PlanPassRequest>,
) -> Result<Json<PassWindow>, (StatusCode, Json<ApiError>)> {
    state
        .scheduler
        .plan_pass(req)
        .map(Json)
        .map_err(scheduler_error)
}

async fn get_pass(
    Path(id): Path<String>,
    State(state): State<PassApiState>,
) -> Result<Json<PassWindow>, (StatusCode, Json<ApiError>)> {
    match state.scheduler.get_pass(&id).map_err(scheduler_error)? {
        Some(pass) => Ok(Json(pass)),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ApiError {
                code: "pass_not_found".to_string(),
                message: format!("pass {} not found", id),
                suggested_alternatives: None,
            }),
        )),
    }
}

async fn schedule_pass(
    Path(id): Path<String>,
    State(state): State<PassApiState>,
    Json(req): Json<SchedulePassRequest>,
) -> Result<Json<PassWindow>, (StatusCode, Json<ApiError>)> {
    state
        .scheduler
        .schedule_pass(&id, req)
        .map(Json)
        .map_err(scheduler_error)
}

async fn track_pass(
    Path((id, antenna_id)): Path<(String, String)>,
    State(state): State<PassApiState>,
    body: Option<Json<TrackPassRequest>>,
) -> Result<Json<CommandReceipt>, (StatusCode, Json<ApiError>)> {
    let req = body.map(|j| j.0).unwrap_or_default();
    let pass_exists = state
        .scheduler
        .get_pass(&id)
        .map_err(scheduler_error)?
        .is_some();
    if !pass_exists {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ApiError {
                code: "pass_not_found".to_string(),
                message: format!("pass {} not found", id),
                suggested_alternatives: None,
            }),
        ));
    }
    let key = req
        .idempotency_key
        .as_ref()
        .map(|k| format!("{}:{}:track_pass", k, antenna_id));
    let receipt = state.get_or_insert_receipt(
        key.as_deref().unwrap_or(""),
        &id,
        &antenna_id,
        "track_pass",
        req.idempotency_key.as_deref(),
        || state.antenna_adapter.track_pass(&id, &antenna_id),
    );
    Ok(Json(receipt))
}

async fn point_antenna(
    Path(id): Path<String>,
    State(state): State<PassApiState>,
    Json(req): Json<PointAntennaRequest>,
) -> Result<Json<CommandReceipt>, (StatusCode, Json<ApiError>)> {
    if !(0.0..=360.0).contains(&req.az_deg) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiError {
                code: "invalid_azimuth".to_string(),
                message: "azimuth must be within [0, 360] degrees".to_string(),
                suggested_alternatives: None,
            }),
        ));
    }
    if !(-5.0..=95.0).contains(&req.el_deg) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiError {
                code: "invalid_elevation".to_string(),
                message: "elevation must be within [-5, 95] degrees".to_string(),
                suggested_alternatives: None,
            }),
        ));
    }
    let at = req.at.unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
    let key = req
        .idempotency_key
        .as_ref()
        .map(|k| format!("{}:{}:slew_to", k, id));
    let receipt = state.get_or_insert_receipt(
        key.as_deref().unwrap_or(""),
        &id,
        &id,
        "slew_to",
        req.idempotency_key.as_deref(),
        || state.antenna_adapter.slew_to(&id, req.az_deg, req.el_deg, &at),
    );
    Ok(Json(receipt))
}

async fn stop_antenna(
    Path(id): Path<String>,
    State(state): State<PassApiState>,
    body: Option<Json<StopAntennaRequest>>,
) -> Json<CommandReceipt> {
    let req = body.map(|j| j.0).unwrap_or_default();
    let key = req
        .idempotency_key
        .as_ref()
        .map(|k| format!("{}:{}:stop", k, id));
    let receipt = state.get_or_insert_receipt(
        key.as_deref().unwrap_or(""),
        &id,
        &id,
        "stop",
        req.idempotency_key.as_deref(),
        || state.antenna_adapter.stop(&id),
    );
    Json(receipt)
}

async fn antenna_commands_log(
    State(state): State<PassApiState>,
    Query(q): Query<CommandLogQuery>,
) -> Json<Vec<CommandLogEntry>> {
    let limit = q.limit.unwrap_or(50).min(200);
    let pass_id = q.pass_id.as_deref();
    if let Ok(log) = state.command_log.read() {
        let mut out: Vec<CommandLogEntry> = log
            .iter()
            .rev()
            .filter(|e| pass_id.map_or(true, |p| e.pass_id == p))
            .take(limit)
            .cloned()
            .collect();
        out.reverse();
        return Json(out);
    }
    Json(Vec::new())
}

async fn audit_log(
    State(state): State<PassApiState>,
    Query(q): Query<AuditLogQuery>,
) -> Json<Vec<AuditEntry>> {
    let limit = q.limit.unwrap_or(100).min(500);
    if let Ok(log) = state.audit_log.read() {
        let out: Vec<AuditEntry> = log.iter().rev().take(limit).cloned().collect();
        return Json(out);
    }
    Json(Vec::new())
}

async fn list_links(
    State(state): State<PassApiState>,
) -> Result<Json<Vec<LinkState>>, (StatusCode, Json<ApiError>)> {
    state
        .network_manager
        .list_links()
        .map(Json)
        .map_err(network_error)
}

async fn upsert_link(
    State(state): State<PassApiState>,
    Json(req): Json<LinkState>,
) -> Result<Json<LinkState>, (StatusCode, Json<ApiError>)> {
    state
        .network_manager
        .upsert_link(req)
        .map(Json)
        .map_err(network_error)
}

async fn plan_route(
    State(state): State<PassApiState>,
    Json(req): Json<TransferPlanRequest>,
) -> Result<Json<TransferPlan>, (StatusCode, Json<ApiError>)> {
    state
        .network_manager
        .plan_transfer(req)
        .map(Json)
        .map_err(network_error)
}

async fn network_audit(
    State(state): State<PassApiState>,
) -> Result<Json<DtnIslAuditReport>, (StatusCode, Json<ApiError>)> {
    state
        .network_manager
        .audit()
        .map(Json)
        .map_err(network_error)
}

async fn telegram_feed(Query(query): Query<FeedQuery>) -> Json<Vec<state::TelegramFeedEntry>> {
    Json(state::get_telegram_feed(query.limit.unwrap_or(50)))
}

async fn approvals_feed(Query(query): Query<FeedQuery>) -> Json<Vec<approval_gate::ApprovalRequest>> {
    let limit = query.limit.unwrap_or(50);
    Json(approval_gate::list_recent(limit))
}
