use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, RwLock};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PassStatus {
    Planned,
    Scheduled,
    Active,
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PassWindow {
    pub pass_id: String,
    pub target: String,
    pub station: String,
    pub aos: String,
    pub los: String,
    pub status: PassStatus,
    pub priority: u8,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PlanPassRequest {
    pub target: String,
    pub station: String,
    pub aos: String,
    pub los: String,
    pub priority: Option<u8>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SchedulePassRequest {
    pub scheduled_start: Option<String>,
    pub scheduled_end: Option<String>,
    pub operator: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandReceipt {
    pub command_id: String,
    pub command_type: String,
    pub target: String,
    pub accepted: bool,
    pub message: String,
    pub issued_at: String,
}

/// Suggested window when a conflict occurs (next free slot on same station).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowSuggestion {
    pub start: String,
    pub end: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SchedulerError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_alternatives: Option<Vec<WindowSuggestion>>,
}

impl std::fmt::Display for SchedulerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for SchedulerError {}

/// Persistence for pass windows. When set, the scheduler calls save after each mutation.
pub trait PassStore: Send + Sync {
    fn load(&self) -> Result<Vec<PassWindow>, SchedulerError>;
    fn save(&self, passes: &[PassWindow]) -> Result<(), SchedulerError>;
}

/// File-based store: JSON array at the given path. Missing file => empty list.
#[derive(Clone)]
pub struct FilePassStore {
    path: std::path::PathBuf,
}

impl FilePassStore {
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self {
            path: path.as_ref().to_path_buf(),
        }
    }
}

impl PassStore for FilePassStore {
    fn load(&self) -> Result<Vec<PassWindow>, SchedulerError> {
        let Ok(data) = std::fs::read_to_string(&self.path) else {
            return Ok(Vec::new());
        };
        serde_json::from_str(&data).map_err(|e| SchedulerError {
            code: "store_load_failed".to_string(),
            message: format!("failed to parse pass store: {}", e),
            suggested_alternatives: None,
        })
    }

    fn save(&self, passes: &[PassWindow]) -> Result<(), SchedulerError> {
        let arr: Vec<&PassWindow> = passes.iter().collect();
        let json = serde_json::to_string_pretty(&arr).map_err(|e| SchedulerError {
            code: "store_save_failed".to_string(),
            message: format!("failed to serialize passes: {}", e),
            suggested_alternatives: None,
        })?;
        if let Some(parent) = self.path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        std::fs::write(&self.path, json).map_err(|e| SchedulerError {
            code: "store_save_failed".to_string(),
            message: format!("failed to write pass store: {}", e),
            suggested_alternatives: None,
        })?;
        Ok(())
    }
}

#[derive(Clone)]
pub struct PassScheduler {
    inner: Arc<RwLock<HashMap<String, PassWindow>>>,
    store: Option<Arc<dyn PassStore>>,
}

impl Default for PassScheduler {
    fn default() -> Self {
        Self {
            inner: Arc::new(RwLock::new(HashMap::new())),
            store: None,
        }
    }
}

impl PassScheduler {
    /// Build scheduler with optional persistence. If store is provided, load() is called to seed and save() after each mutation.
    pub fn with_store(store: Arc<dyn PassStore>) -> Result<Self, SchedulerError> {
        let passes = store.load()?;
        let inner: HashMap<String, PassWindow> = passes
            .into_iter()
            .map(|p| (p.pass_id.clone(), p))
            .collect();
        Ok(Self {
            inner: Arc::new(RwLock::new(inner)),
            store: Some(store),
        })
    }

    fn persist(&self) -> Result<(), SchedulerError> {
        if let Some(ref store) = self.store {
            let store_guard = self.inner.read().map_err(|_| SchedulerError {
                code: "store_poisoned".to_string(),
                message: "pass scheduler storage lock poisoned".to_string(),
                suggested_alternatives: None,
            })?;
            let passes: Vec<PassWindow> = store_guard.values().cloned().collect();
            drop(store_guard);
            store.save(&passes)?;
        }
        Ok(())
    }
}

impl PassScheduler {
    pub fn plan_pass(&self, req: PlanPassRequest) -> Result<PassWindow, SchedulerError> {
        if req.target.trim().is_empty() {
            return Err(SchedulerError {
                code: "invalid_target".to_string(),
                message: "target is required".to_string(),
                suggested_alternatives: None,
            });
        }
        if req.station.trim().is_empty() {
            return Err(SchedulerError {
                code: "invalid_station".to_string(),
                message: "station is required".to_string(),
                suggested_alternatives: None,
            });
        }

        let aos = parse_rfc3339(&req.aos, "invalid_aos")?;
        let los = parse_rfc3339(&req.los, "invalid_los")?;
        if los <= aos {
            return Err(SchedulerError {
                code: "invalid_window".to_string(),
                message: "LOS must be after AOS".to_string(),
                suggested_alternatives: None,
            });
        }

        let mut store = self.inner.write().map_err(|_| SchedulerError {
            code: "store_poisoned".to_string(),
            message: "pass scheduler storage lock poisoned".to_string(),
            suggested_alternatives: None,
        })?;

        for existing in store.values() {
            if existing.station != req.station {
                continue;
            }
            let existing_aos = parse_rfc3339(&existing.aos, "invalid_existing_aos")?;
            let existing_los = parse_rfc3339(&existing.los, "invalid_existing_los")?;
            if windows_overlap(aos, los, existing_aos, existing_los) {
                let alternatives = suggest_alternatives(store.values(), &req.station, aos, los);
                return Err(SchedulerError {
                    code: "window_conflict".to_string(),
                    message: format!(
                        "pass window overlaps with existing pass {} on station {}",
                        existing.pass_id, existing.station
                    ),
                    suggested_alternatives: Some(alternatives),
                });
            }
        }

        let priority = req.priority.unwrap_or(5).clamp(1, 10);
        let pass = PassWindow {
            pass_id: Uuid::new_v4().to_string(),
            target: req.target.trim().to_string(),
            station: req.station.trim().to_string(),
            aos: req.aos,
            los: req.los,
            status: PassStatus::Planned,
            priority,
            updated_at: Utc::now().to_rfc3339(),
        };

        store.insert(pass.pass_id.clone(), pass.clone());
        drop(store);
        self.persist()?;
        Ok(pass)
    }

    pub fn get_pass(&self, pass_id: &str) -> Result<Option<PassWindow>, SchedulerError> {
        let store = self.inner.read().map_err(|_| SchedulerError {
            code: "store_poisoned".to_string(),
            message: "pass scheduler storage lock poisoned".to_string(),
            suggested_alternatives: None,
        })?;
        Ok(store.get(pass_id).cloned())
    }

    pub fn list_passes(&self) -> Result<Vec<PassWindow>, SchedulerError> {
        let store = self.inner.read().map_err(|_| SchedulerError {
            code: "store_poisoned".to_string(),
            message: "pass scheduler storage lock poisoned".to_string(),
            suggested_alternatives: None,
        })?;
        let mut items = store.values().cloned().collect::<Vec<_>>();
        items.sort_by(|a, b| a.aos.cmp(&b.aos));
        Ok(items)
    }

    pub fn schedule_pass(
        &self,
        pass_id: &str,
        req: SchedulePassRequest,
    ) -> Result<PassWindow, SchedulerError> {
        let mut store = self.inner.write().map_err(|_| SchedulerError {
            code: "store_poisoned".to_string(),
            message: "pass scheduler storage lock poisoned".to_string(),
            suggested_alternatives: None,
        })?;

        let Some(pass) = store.get_mut(pass_id) else {
            return Err(SchedulerError {
                code: "pass_not_found".to_string(),
                message: format!("pass {} was not found", pass_id),
                suggested_alternatives: None,
            });
        };

        let start = req.scheduled_start.as_deref().unwrap_or(&pass.aos);
        let end = req.scheduled_end.as_deref().unwrap_or(&pass.los);
        let start_dt = parse_rfc3339(start, "invalid_schedule_start")?;
        let end_dt = parse_rfc3339(end, "invalid_schedule_end")?;
        if end_dt <= start_dt {
            return Err(SchedulerError {
                code: "invalid_schedule_window".to_string(),
                message: "scheduled end must be after scheduled start".to_string(),
                suggested_alternatives: None,
            });
        }

        pass.aos = start.to_string();
        pass.los = end.to_string();
        pass.status = PassStatus::Scheduled;
        pass.updated_at = Utc::now().to_rfc3339();
        if let Some(operator) = req.operator {
            tracing::info!(pass_id = %pass_id, operator = %operator, "pass scheduled by operator");
        }
        let out = pass.clone();
        drop(store);
        self.persist()?;
        Ok(out)
    }
}

pub trait AntennaAdapter: Send + Sync {
    fn slew_to(&self, antenna_id: &str, az_deg: f64, el_deg: f64, at: &str) -> CommandReceipt;
    fn track_pass(&self, pass_id: &str, antenna_id: &str) -> CommandReceipt;
    fn stop(&self, antenna_id: &str) -> CommandReceipt;
}

#[derive(Clone, Default)]
pub struct MockAntennaAdapter;

impl AntennaAdapter for MockAntennaAdapter {
    fn slew_to(&self, antenna_id: &str, az_deg: f64, el_deg: f64, at: &str) -> CommandReceipt {
        CommandReceipt {
            command_id: Uuid::new_v4().to_string(),
            command_type: "slew_to".to_string(),
            target: antenna_id.to_string(),
            accepted: true,
            message: format!(
                "queued slew command az={:.2}deg el={:.2}deg at={}",
                az_deg, el_deg, at
            ),
            issued_at: Utc::now().to_rfc3339(),
        }
    }

    fn track_pass(&self, pass_id: &str, antenna_id: &str) -> CommandReceipt {
        CommandReceipt {
            command_id: Uuid::new_v4().to_string(),
            command_type: "track_pass".to_string(),
            target: antenna_id.to_string(),
            accepted: true,
            message: format!("queued tracking command for pass {}", pass_id),
            issued_at: Utc::now().to_rfc3339(),
        }
    }

    fn stop(&self, antenna_id: &str) -> CommandReceipt {
        CommandReceipt {
            command_id: Uuid::new_v4().to_string(),
            command_type: "stop".to_string(),
            target: antenna_id.to_string(),
            accepted: true,
            message: "queued stop command".to_string(),
            issued_at: Utc::now().to_rfc3339(),
        }
    }
}

fn parse_rfc3339(input: &str, code: &str) -> Result<DateTime<Utc>, SchedulerError> {
    DateTime::parse_from_rfc3339(input)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|_| SchedulerError {
            code: code.to_string(),
            message: format!("expected RFC3339 timestamp, got {}", input),
            suggested_alternatives: None,
        })
}

/// Compute suggested free windows on the given station after a conflict. Returns up to 3 gaps that fit the requested duration (or 5 min minimum).
fn suggest_alternatives<'a>(
    existing: impl Iterator<Item = &'a PassWindow>,
    station: &str,
    req_start: DateTime<Utc>,
    req_end: DateTime<Utc>,
) -> Vec<WindowSuggestion> {
    const MIN_DURATION_MINUTES: i64 = 5;
    let req_dur = (req_end - req_start).num_minutes().max(MIN_DURATION_MINUTES);
    let mut on_station: Vec<(DateTime<Utc>, DateTime<Utc>)> = existing
        .filter(|p| p.station == station)
        .filter_map(|p| {
            DateTime::parse_from_rfc3339(&p.aos)
                .ok()
                .zip(DateTime::parse_from_rfc3339(&p.los).ok())
                .map(|(a, b)| (a.with_timezone(&Utc), b.with_timezone(&Utc)))
        })
        .collect();
    on_station.sort_by_key(|(a, _)| *a);
    let mut out = Vec::new();
    let mut cursor = req_start;
    for (aos, los) in on_station {
        while aos > cursor {
            let gap_min = (aos - cursor).num_minutes();
            if gap_min >= req_dur {
                let end = cursor + chrono::Duration::minutes(req_dur);
                out.push(WindowSuggestion {
                    start: cursor.to_rfc3339(),
                    end: end.to_rfc3339(),
                });
                cursor = end;
                if out.len() >= 3 {
                    return out;
                }
            } else {
                break;
            }
        }
        if los > cursor {
            cursor = los;
        }
    }
    out
}

fn windows_overlap(
    a_start: DateTime<Utc>,
    a_end: DateTime<Utc>,
    b_start: DateTime<Utc>,
    b_end: DateTime<Utc>,
) -> bool {
    a_start < b_end && b_start < a_end
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan(target: &str, station: &str, aos: &str, los: &str) -> PlanPassRequest {
        PlanPassRequest {
            target: target.to_string(),
            station: station.to_string(),
            aos: aos.to_string(),
            los: los.to_string(),
            priority: Some(5),
        }
    }

    #[test]
    fn detects_window_conflict_on_same_station() {
        let scheduler = PassScheduler::default();
        let first = scheduler
            .plan_pass(plan(
                "DSCOVR",
                "GAUSS-GS-1",
                "2026-02-22T00:05:00Z",
                "2026-02-22T00:17:00Z",
            ))
            .expect("first pass should be accepted");
        assert_eq!(first.station, "GAUSS-GS-1");

        let conflict = scheduler.plan_pass(plan(
            "SOHO",
            "GAUSS-GS-1",
            "2026-02-22T00:10:00Z",
            "2026-02-22T00:20:00Z",
        ));
        assert!(conflict.is_err());
        assert_eq!(conflict.err().unwrap().code, "window_conflict");
    }

    #[test]
    fn allows_overlapping_windows_on_different_stations() {
        let scheduler = PassScheduler::default();
        scheduler
            .plan_pass(plan(
                "DSCOVR",
                "GAUSS-GS-1",
                "2026-02-22T00:05:00Z",
                "2026-02-22T00:17:00Z",
            ))
            .expect("first pass should be accepted");

        let second = scheduler
            .plan_pass(plan(
                "SOHO",
                "GAUSS-GS-2",
                "2026-02-22T00:10:00Z",
                "2026-02-22T00:20:00Z",
            ))
            .expect("second pass on different station should be accepted");
        assert_eq!(second.station, "GAUSS-GS-2");
    }
}
