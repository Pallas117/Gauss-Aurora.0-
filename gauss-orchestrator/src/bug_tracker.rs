use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Bug severity levels
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum Severity {
    Critical,
    High,
    Medium,
    Low,
    Informational,
}

impl std::fmt::Display for Severity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Severity::Critical => write!(f, "CRITICAL"),
            Severity::High => write!(f, "HIGH"),
            Severity::Medium => write!(f, "MEDIUM"),
            Severity::Low => write!(f, "LOW"),
            Severity::Informational => write!(f, "INFO"),
        }
    }
}

/// Bug status tracking
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum BugStatus {
    Reported,
    Acknowledged,
    InProgress,
    Fixed,
    Closed,
}

impl std::fmt::Display for BugStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BugStatus::Reported => write!(f, "REPORTED"),
            BugStatus::Acknowledged => write!(f, "ACKNOWLEDGED"),
            BugStatus::InProgress => write!(f, "IN_PROGRESS"),
            BugStatus::Fixed => write!(f, "FIXED"),
            BugStatus::Closed => write!(f, "CLOSED"),
        }
    }
}

/// Bug report with metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BugReport {
    pub id: String,
    pub title: String,
    pub description: String,
    pub severity: Severity,
    pub status: BugStatus,
    pub module: String,
    pub reported_at: DateTime<Utc>,
    pub fixed_at: Option<DateTime<Utc>>,
    pub reproduction_steps: Vec<String>,
    pub error_message: Option<String>,
    pub tags: Vec<String>,
}

impl BugReport {
    /// Create a new bug report
    pub fn new(title: String, description: String, severity: Severity, module: String) -> Self {
        let id = format!(
            "BUG-{}",
            uuid::Uuid::new_v4().to_string()[..8].to_uppercase()
        );
        Self {
            id,
            title,
            description,
            severity,
            status: BugStatus::Reported,
            module,
            reported_at: Utc::now(),
            fixed_at: None,
            reproduction_steps: Vec::new(),
            error_message: None,
            tags: Vec::new(),
        }
    }

    /// Add reproduction steps
    pub fn with_steps(mut self, steps: Vec<String>) -> Self {
        self.reproduction_steps = steps;
        self
    }

    /// Add error message
    pub fn with_error(mut self, error: String) -> Self {
        self.error_message = Some(error);
        self
    }

    /// Add tags
    pub fn with_tags(mut self, tags: Vec<String>) -> Self {
        self.tags = tags;
        self
    }

    /// Mark as fixed
    pub fn mark_fixed(&mut self) {
        self.status = BugStatus::Fixed;
        self.fixed_at = Some(Utc::now());
    }
}

/// Bug tracking system
pub struct BugTracker {
    reports: HashMap<String, BugReport>,
}

impl BugTracker {
    /// Create a new bug tracker
    pub fn new() -> Self {
        Self {
            reports: HashMap::new(),
        }
    }

    /// Report a new bug
    pub fn report(&mut self, bug: BugReport) -> String {
        let id = bug.id.clone();
        self.reports.insert(id.clone(), bug);
        id
    }

    /// Get a bug report by ID
    pub fn get(&self, id: &str) -> Option<&BugReport> {
        self.reports.get(id)
    }

    /// Get mutable reference to bug report
    pub fn get_mut(&mut self, id: &str) -> Option<&mut BugReport> {
        self.reports.get_mut(id)
    }

    /// Update bug status
    pub fn update_status(&mut self, id: &str, status: BugStatus) -> bool {
        if let Some(bug) = self.reports.get_mut(id) {
            bug.status = status;
            if status == BugStatus::Fixed {
                bug.fixed_at = Some(Utc::now());
            }
            true
        } else {
            false
        }
    }

    /// Get all critical and high-severity bugs
    pub fn get_high_priority(&self) -> Vec<&BugReport> {
        self.reports
            .values()
            .filter(|b| b.severity == Severity::Critical || b.severity == Severity::High)
            .collect()
    }

    /// Get all active (non-closed) bugs
    pub fn get_active(&self) -> Vec<&BugReport> {
        self.reports
            .values()
            .filter(|b| b.status != BugStatus::Closed)
            .collect()
    }

    /// Get bugs by module
    pub fn get_by_module(&self, module: &str) -> Vec<&BugReport> {
        self.reports
            .values()
            .filter(|b| b.module == module)
            .collect()
    }

    /// Count bugs by status
    pub fn count_by_status(&self) -> HashMap<BugStatus, usize> {
        let mut counts = HashMap::new();
        for bug in self.reports.values() {
            *counts.entry(bug.status).or_insert(0) += 1;
        }
        counts
    }
}

impl Default for BugTracker {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bug_report_creation() {
        let bug = BugReport::new(
            "Test Bug".to_string(),
            "Test Description".to_string(),
            Severity::High,
            "routing".to_string(),
        );
        assert_eq!(bug.status, BugStatus::Reported);
        assert!(bug.fixed_at.is_none());
    }

    #[test]
    fn test_bug_report_with_steps() {
        let bug = BugReport::new(
            "Bug".to_string(),
            "Desc".to_string(),
            Severity::Low,
            "test".to_string(),
        )
        .with_steps(vec!["Step 1".to_string(), "Step 2".to_string()]);
        assert_eq!(bug.reproduction_steps.len(), 2);
    }

    #[test]
    fn test_bug_tracker_report() {
        let mut tracker = BugTracker::new();
        let bug = BugReport::new(
            "Bug".to_string(),
            "Desc".to_string(),
            Severity::Medium,
            "core".to_string(),
        );
        let id = tracker.report(bug);
        assert!(tracker.get(&id).is_some());
    }

    #[test]
    fn test_bug_tracker_mark_fixed() {
        let mut tracker = BugTracker::new();
        let bug = BugReport::new(
            "Bug".to_string(),
            "Desc".to_string(),
            Severity::Critical,
            "core".to_string(),
        );
        let id = tracker.report(bug);
        tracker.update_status(&id, BugStatus::Fixed);
        assert_eq!(tracker.get(&id).unwrap().status, BugStatus::Fixed);
    }

    #[test]
    fn test_bug_tracker_high_priority() {
        let mut tracker = BugTracker::new();
        tracker.report(BugReport::new(
            "Critical".to_string(),
            "D".to_string(),
            Severity::Critical,
            "x".to_string(),
        ));
        tracker.report(BugReport::new(
            "Low".to_string(),
            "D".to_string(),
            Severity::Low,
            "x".to_string(),
        ));
        assert_eq!(tracker.get_high_priority().len(), 1);
    }
}
