//! Continuous Operational Integrity (COI) Module
//! Periodically runs architectural, security, and resource audits to ensure the system remains within bounds.

use crate::slack_connector::SlackConnector;
use crate::telegram_connector::TelegramConnector;
use serde::Serialize;
use std::process::Command;
use std::time::Duration;
use tokio::time::sleep;

#[derive(Debug, Serialize, Clone)]
pub struct CoiStatus {
    pub timestamp: String,
    pub interop_passed: bool,
    pub compliance_passed: bool,
    pub memory_audit_passed: bool,
    pub domain_boundaries_intact: bool,
    pub issues: Vec<String>,
}

pub struct CoiSupervisor {
    telegram: TelegramConnector,
    slack: Option<SlackConnector>,
    interval: Duration,
}

impl CoiSupervisor {
    pub fn new(telegram: TelegramConnector, interval: Duration) -> Self {
        Self {
            telegram,
            slack: SlackConnector::from_env(),
            interval,
        }
    }

    pub async fn run_loop(&self) {
        tracing::info!("COI Supervisor started with interval {:?}", self.interval);

        loop {
            let status = self.run_audit().await;
            self.report_status(&status).await;

            sleep(self.interval).await;
        }
    }

    async fn run_audit(&self) -> CoiStatus {
        let mut issues = Vec::new();

        // 1. Interoperability Check
        let interop_passed = self.run_npm_script("develop:interoperability", &mut issues);

        // 2. Compliance Check
        let compliance_passed = self.run_npm_script("compliance:check", &mut issues);

        // 3. Memory Audit
        let memory_audit_passed = self.run_npm_script("memory:audit", &mut issues);

        // 4. Domain Boundaries Check
        let domain_boundaries_intact = self.check_domain_boundaries(&mut issues);

        CoiStatus {
            timestamp: chrono::Utc::now().to_rfc3339(),
            interop_passed,
            compliance_passed,
            memory_audit_passed,
            domain_boundaries_intact,
            issues,
        }
    }

    fn run_npm_script(&self, script: &str, issues: &mut Vec<String>) -> bool {
        let output = Command::new("npm").args(["run", script]).output();

        match output {
            Ok(out) => {
                if !out.status.success() {
                    let err = String::from_utf8_lossy(&out.stderr);
                    issues.push(format!("npm run {} failed: {}", script, err.trim()));
                    false
                } else {
                    true
                }
            }
            Err(e) => {
                issues.push(format!("failed to execute npm run {}: {}", script, e));
                false
            }
        }
    }

    fn check_domain_boundaries(&self, issues: &mut Vec<String>) -> bool {
        // Simple check: Frontend (src/) should not import from Backend (backend/) source directly
        // We look for 'import ... from "../../backend/..."' or similar in src/**/*.tsx?

        let output = Command::new("grep")
            .args([
                "-r",
                "--include=*.ts",
                "--include=*.tsx",
                "from ['\"].*backend/.*['\"]",
                "src",
            ])
            .output();

        match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                if !stdout.is_empty() {
                    for line in stdout.lines() {
                        issues.push(format!("Architectural Boundary Violation: {}", line));
                    }
                    false
                } else {
                    true
                }
            }
            Err(e) => {
                issues.push(format!("failed to run domain boundary check: {}", e));
                false
            }
        }
    }

    async fn report_status(&self, status: &CoiStatus) {
        if !status.interop_passed
            || !status.compliance_passed
            || !status.memory_audit_passed
            || !status.domain_boundaries_intact
        {
            let mut msg = "<b>⚠️ COI Alert: System Integrity Compromised</b>\n\n".to_string();
            if !status.interop_passed {
                msg.push_str("• Interoperability: ❌ FAIL\n");
            }
            if !status.compliance_passed {
                msg.push_str("• Compliance: ❌ FAIL\n");
            }
            if !status.memory_audit_passed {
                msg.push_str("• Memory Audit: ❌ FAIL\n");
            }
            if !status.domain_boundaries_intact {
                msg.push_str("• Domain Boundaries: ❌ FAIL\n");
            }

            if !status.issues.is_empty() {
                msg.push_str("\n<b>Issues:</b>\n");
                for issue in status.issues.iter().take(5) {
                    msg.push_str(&format!("• <code>{}</code>\n", issue));
                }
                if status.issues.len() > 5 {
                    msg.push_str(&format!("• ...and {} more\n", status.issues.len() - 5));
                }
            }

            self.telegram.notify(&msg).await;
            if let Some(ref slack) = self.slack {
                let _ = slack
                    .notify(&format!("[COI] Integrity Failure at {}", status.timestamp))
                    .await;
            }
            tracing::warn!("COI Integrity Failure reported");
        } else {
            tracing::info!("COI Integrity Check passed at {}", status.timestamp);
        }

        // Write the latest status to a file for the backend/HUD to consume
        let _ = std::fs::write(
            "reports/monitoring/coi-status.latest.json",
            serde_json::to_string_pretty(status).unwrap_or_default(),
        );
    }
}
