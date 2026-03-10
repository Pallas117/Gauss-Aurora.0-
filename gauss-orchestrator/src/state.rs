use crate::types::TelemetryAnalysis;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use uuid::Uuid;

lazy_static::lazy_static! {
    static ref ANALYSIS_BUFFER: Mutex<Vec<TelemetryAnalysis>> = Mutex::new(Vec::new());
    static ref TELEGRAM_FEED_BUFFER: Mutex<Vec<TelegramFeedEntry>> = Mutex::new(Vec::new());
    /// Last decision from DeepSeek (operator/decision-maker); set by routing after local inference.
    static ref LAST_OPERATOR_DECISION: Mutex<Option<String>> = Mutex::new(None);
}

pub fn push_analysis(a: TelemetryAnalysis) {
    if let Ok(mut guard) = ANALYSIS_BUFFER.lock() {
        guard.push(a);
        if guard.len() > 1000 {
            guard.remove(0);
        }
    }
}

pub fn get_latest_analysis() -> Option<TelemetryAnalysis> {
    if let Ok(guard) = ANALYSIS_BUFFER.lock() {
        guard.last().cloned()
    } else {
        None
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TelegramFeedEntry {
    pub id: String,
    pub timestamp: String,
    pub direction: String,
    pub kind: String,
    pub text: String,
}

/// Push a telegram feed event into the in-memory buffer.
pub fn push_telegram_feed(direction: &str, kind: &str, text: &str) {
    if let Ok(mut guard) = TELEGRAM_FEED_BUFFER.lock() {
        guard.push(TelegramFeedEntry {
            id: Uuid::new_v4().to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            direction: direction.to_string(),
            kind: kind.to_string(),
            text: text.to_string(),
        });
        if guard.len() > 1000 {
            guard.remove(0);
        }
    }
}

/// Set the last operator (DeepSeek) decision after routing to local engine.
pub fn set_last_operator_decision(decision: Option<String>) {
    if let Ok(mut guard) = LAST_OPERATOR_DECISION.lock() {
        *guard = decision;
    }
}

/// Get the last operator decision, if any.
pub fn get_last_operator_decision() -> Option<String> {
    if let Ok(guard) = LAST_OPERATOR_DECISION.lock() {
        guard.clone()
    } else {
        None
    }
}

/// Return newest telegram feed entries, newest-first.
pub fn get_telegram_feed(limit: usize) -> Vec<TelegramFeedEntry> {
    if let Ok(guard) = TELEGRAM_FEED_BUFFER.lock() {
        let take = limit.max(1).min(200);
        guard.iter().rev().take(take).cloned().collect()
    } else {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::{get_latest_analysis, push_analysis, ANALYSIS_BUFFER};
    use crate::types::{Sensitivity, TelemetryAnalysis};
    use std::sync::Mutex;

    lazy_static::lazy_static! {
        static ref TEST_MUTEX: Mutex<()> = Mutex::new(());
    }

    fn sample_analysis(id: usize) -> TelemetryAnalysis {
        TelemetryAnalysis {
            timestamp: format!("2026-03-06T11:00:{id:02}Z"),
            sensitivity: Sensitivity::Low,
            detected_patterns: vec![format!("pattern-{id}")],
            file_name: format!("sample-{id}.csv"),
        }
    }

    fn clear_analysis_buffer() {
        let mut guard = ANALYSIS_BUFFER.lock().expect("analysis buffer lock poisoned");
        guard.clear();
    }

    #[test]
    fn push_and_get_latest_analysis() {
        let _test_guard = TEST_MUTEX.lock().expect("test mutex lock poisoned");
        clear_analysis_buffer();
        push_analysis(sample_analysis(1));
        push_analysis(sample_analysis(2));

        let latest = get_latest_analysis().expect("expected latest analysis");
        assert_eq!(latest.file_name, "sample-2.csv");
        assert_eq!(latest.detected_patterns, vec!["pattern-2".to_string()]);

        clear_analysis_buffer();
    }

    #[test]
    fn analysis_buffer_caps_at_1000_entries() {
        let _test_guard = TEST_MUTEX.lock().expect("test mutex lock poisoned");
        clear_analysis_buffer();

        for idx in 0..1005 {
            push_analysis(sample_analysis(idx));
        }

        let guard = ANALYSIS_BUFFER.lock().expect("analysis buffer lock poisoned");
        assert_eq!(guard.len(), 1000);
        assert_eq!(guard.first().map(|item| item.file_name.as_str()), Some("sample-5.csv"));
        assert_eq!(guard.last().map(|item| item.file_name.as_str()), Some("sample-1004.csv"));

        drop(guard);
        clear_analysis_buffer();
    }
}
