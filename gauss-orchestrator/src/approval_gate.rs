use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tokio::time::sleep;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum ApprovalStatus {
    Pending,
    Approved,
    Denied,
    Expired,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ApprovalRequest {
    pub id: String,
    pub topic: String,
    pub prompt: String,
    pub requested_at: String,
    pub expires_at: String,
    pub status: ApprovalStatus,
    pub resolved_by: Option<String>,
    pub resolved_at: Option<String>,
}

lazy_static::lazy_static! {
    static ref APPROVALS: Mutex<HashMap<String, ApprovalRequest>> = Mutex::new(HashMap::new());
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub fn create_request(topic: &str, prompt: &str, timeout_secs: u64) -> ApprovalRequest {
    let now = chrono::Utc::now();
    let expires = now + chrono::Duration::seconds(timeout_secs.max(1) as i64);
    let req = ApprovalRequest {
        id: Uuid::new_v4().to_string(),
        topic: topic.to_string(),
        prompt: prompt.to_string(),
        requested_at: now.to_rfc3339(),
        expires_at: expires.to_rfc3339(),
        status: ApprovalStatus::Pending,
        resolved_by: None,
        resolved_at: None,
    };
    if let Ok(mut guard) = APPROVALS.lock() {
        guard.insert(req.id.clone(), req.clone());
    }
    req
}

pub fn resolve_request(id: &str, approved: bool, actor: &str) -> Option<ApprovalRequest> {
    if let Ok(mut guard) = APPROVALS.lock() {
        let req = guard.get_mut(id)?;
        if req.status != ApprovalStatus::Pending {
            return Some(req.clone());
        }
        req.status = if approved {
            ApprovalStatus::Approved
        } else {
            ApprovalStatus::Denied
        };
        req.resolved_by = Some(actor.to_string());
        req.resolved_at = Some(now_iso());
        return Some(req.clone());
    }
    None
}

pub fn list_recent(limit: usize) -> Vec<ApprovalRequest> {
    if let Ok(guard) = APPROVALS.lock() {
        let mut values: Vec<ApprovalRequest> = guard.values().cloned().collect();
        values.sort_by(|a, b| b.requested_at.cmp(&a.requested_at));
        values.truncate(limit.max(1).min(200));
        values
    } else {
        Vec::new()
    }
}

pub fn list_pending(limit: usize) -> Vec<ApprovalRequest> {
    list_recent(limit)
        .into_iter()
        .filter(|req| req.status == ApprovalStatus::Pending)
        .collect()
}

pub fn latest_pending() -> Option<ApprovalRequest> {
    list_pending(1).into_iter().next()
}

pub fn expire_overdue() -> usize {
    let now = chrono::Utc::now();
    if let Ok(mut guard) = APPROVALS.lock() {
        let mut expired = 0;
        for req in guard.values_mut() {
            if req.status != ApprovalStatus::Pending {
                continue;
            }
            let expires = chrono::DateTime::parse_from_rfc3339(&req.expires_at)
                .map(|v| v.with_timezone(&chrono::Utc))
                .unwrap_or(now);
            if expires <= now {
                req.status = ApprovalStatus::Expired;
                req.resolved_at = Some(now_iso());
                expired += 1;
            }
        }
        expired
    } else {
        0
    }
}

pub fn get_request(id: &str) -> Option<ApprovalRequest> {
    if let Ok(guard) = APPROVALS.lock() {
        guard.get(id).cloned()
    } else {
        None
    }
}

pub async fn wait_for_decision(id: &str, timeout_secs: u64) -> ApprovalStatus {
    let started = chrono::Utc::now();
    let timeout = chrono::Duration::seconds(timeout_secs.max(1) as i64);

    loop {
        expire_overdue();
        if let Some(req) = get_request(id) {
            if req.status != ApprovalStatus::Pending {
                return req.status;
            }
        } else {
            return ApprovalStatus::Expired;
        }

        if chrono::Utc::now() - started >= timeout {
            if let Ok(mut guard) = APPROVALS.lock() {
                if let Some(req) = guard.get_mut(id) {
                    if req.status == ApprovalStatus::Pending {
                        req.status = ApprovalStatus::Expired;
                        req.resolved_at = Some(now_iso());
                    }
                }
            }
            return ApprovalStatus::Expired;
        }

        sleep(Duration::from_secs(2)).await;
    }
}
