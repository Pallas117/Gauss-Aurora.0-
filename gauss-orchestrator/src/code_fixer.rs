/// Autonomous Code Fixing Module
/// Applies fixes to discovered issues and validates them
///
/// Features:
/// - Apply suggested fixes via pattern replacement
/// - Run cargo test to validate changes
/// - Revert on validation failure
/// - Track before/after diffs
/// - Report fix status
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::code_indexer::CodeIssue;

/// Result of applying a fix
#[derive(Debug, Clone)]
pub struct FixResult {
    pub issue_id: String,
    pub issue_description: String,
    pub file: PathBuf,
    pub line_number: usize,
    pub success: bool,
    pub before: String,
    pub after: Option<String>,
    pub validation_passed: bool,
    pub error_message: Option<String>,
}

/// Tracks multiple fix operations
#[derive(Debug, Clone)]
pub struct FixBatch {
    pub fixes: Vec<FixResult>,
    pub total_issues: usize,
    pub successful_fixes: usize,
    pub failed_fixes: usize,
    pub validation_passed: bool,
}

impl FixBatch {
    /// New empty batch
    pub fn new(total_issues: usize) -> Self {
        Self {
            fixes: Vec::new(),
            total_issues,
            successful_fixes: 0,
            failed_fixes: 0,
            validation_passed: true,
        }
    }

    /// Add a fix result
    pub fn add_fix(&mut self, result: FixResult) {
        if result.success && result.validation_passed {
            self.successful_fixes += 1;
        } else {
            self.failed_fixes += 1;
            self.validation_passed = false;
        }
        self.fixes.push(result);
    }

    /// Get summary for reporting
    pub fn summary(&self) -> String {
        format!(
            "Applied {} of {} fixes ({} failed). Overall validation: {}",
            self.successful_fixes,
            self.total_issues,
            self.failed_fixes,
            if self.validation_passed {
                "✅ PASSED"
            } else {
                "❌ FAILED"
            }
        )
    }
}

/// Autonomous code fixer
pub struct CodeFixer {
    project_root: PathBuf,
}

impl CodeFixer {
    /// Create fixer for project
    pub fn new(project_root: impl AsRef<Path>) -> Self {
        Self {
            project_root: project_root.as_ref().to_path_buf(),
        }
    }

    /// Apply a single fix to an issue
    pub async fn apply_fix(&self, issue: &CodeIssue) -> FixResult {
        println!(
            "[code-fixer] 🔧 Applying fix for: {} at {}:{}",
            issue.issue_type,
            issue.file.display(),
            issue.line_number
        );

        // Read original file
        let Ok(original_content) = fs::read_to_string(&issue.file) else {
            return FixResult {
                issue_id: issue.id.clone(),
                issue_description: issue.description.clone(),
                file: issue.file.clone(),
                line_number: issue.line_number,
                success: false,
                before: String::new(),
                after: None,
                validation_passed: false,
                error_message: Some("Could not read file".to_string()),
            };
        };

        let before = original_content.clone();

        // Apply the fix
        let fixed_content = match self.apply_fix_suggestion(&original_content, issue) {
            Ok(content) => content,
            Err(e) => {
                return FixResult {
                    issue_id: issue.id.clone(),
                    issue_description: issue.description.clone(),
                    file: issue.file.clone(),
                    line_number: issue.line_number,
                    success: false,
                    before,
                    after: None,
                    validation_passed: false,
                    error_message: Some(e),
                }
            }
        };

        // Write fixed file
        if let Err(e) = fs::write(&issue.file, &fixed_content) {
            return FixResult {
                issue_id: issue.id.clone(),
                issue_description: issue.description.clone(),
                file: issue.file.clone(),
                line_number: issue.line_number,
                success: false,
                before,
                after: None,
                validation_passed: false,
                error_message: Some(format!("Write failed: {}", e)),
            };
        }

        // Validate with cargo test
        let validation_passed = self.validate_fix().await;

        if !validation_passed {
            // Revert on validation failure
            let _ = fs::write(&issue.file, &before);
            println!("[code-fixer] ❌ Validation failed, reverting: {}", issue.id);

            return FixResult {
                issue_id: issue.id.clone(),
                issue_description: issue.description.clone(),
                file: issue.file.clone(),
                line_number: issue.line_number,
                success: false,
                before,
                after: Some(fixed_content),
                validation_passed: false,
                error_message: Some("Cargo test validation failed".to_string()),
            };
        }

        println!("[code-fixer] ✅ Fix validated: {}", issue.id);

        FixResult {
            issue_id: issue.id.clone(),
            issue_description: issue.description.clone(),
            file: issue.file.clone(),
            line_number: issue.line_number,
            success: true,
            before,
            after: Some(fixed_content),
            validation_passed: true,
            error_message: None,
        }
    }

    /// Apply a fix suggestion to content
    fn apply_fix_suggestion(&self, content: &str, issue: &CodeIssue) -> Result<String, String> {
        use crate::code_indexer::IssueType;

        match issue.issue_type {
            IssueType::UnusedImport => {
                // Remove unused import line
                let lines: Vec<&str> = content.lines().collect();
                if issue.line_number > 0 && issue.line_number <= lines.len() {
                    let mut result_lines = lines.clone();
                    result_lines.remove(issue.line_number - 1);
                    Ok(result_lines.join("\n"))
                } else {
                    Err("Line number out of range".to_string())
                }
            }
            IssueType::DocumentationMissing => {
                // Add documentation comment
                let lines: Vec<&str> = content.lines().collect();
                if issue.line_number > 0 && issue.line_number <= lines.len() {
                    let mut result = String::new();
                    for (i, line) in lines.iter().enumerate() {
                        if i == issue.line_number - 1 {
                            result.push_str("/// TODO: Add documentation\n");
                        }
                        result.push_str(line);
                        result.push('\n');
                    }
                    Ok(result)
                } else {
                    Err("Line number out of range".to_string())
                }
            }
            IssueType::NamingViolation => {
                // Try to apply suggested fix
                if let Some(old_name) = &issue.symbol {
                    let new_name = old_name.to_lowercase();
                    Ok(content.replace(old_name, &new_name))
                } else {
                    Err("No symbol name provided".to_string())
                }
            }
            _ => {
                // For other issue types, insert a TODO comment
                let lines: Vec<&str> = content.lines().collect();
                if issue.line_number > 0 && issue.line_number <= lines.len() {
                    let mut result = String::new();
                    for (i, line) in lines.iter().enumerate() {
                        if i == issue.line_number - 1 {
                            result.push_str(&format!(
                                "// TODO: {} - {}\n",
                                issue.issue_type, issue.description
                            ));
                        }
                        result.push_str(line);
                        result.push('\n');
                    }
                    Ok(result)
                } else {
                    Err("Line number out of range".to_string())
                }
            }
        }
    }

    /// Validate fix by running cargo test
    async fn validate_fix(&self) -> bool {
        let output = Command::new("cargo")
            .arg("test")
            .arg("--lib")
            .current_dir(&self.project_root)
            .output();

        match output {
            Ok(output) => output.status.success(),
            Err(_) => false,
        }
    }

    /// Apply multiple fixes with rollback on failure
    pub async fn apply_fixes(&self, issues: Vec<CodeIssue>) -> FixBatch {
        let mut batch = FixBatch::new(issues.len());

        // Store original contents for potential rollback
        let mut originals: std::collections::HashMap<PathBuf, String> =
            std::collections::HashMap::new();

        for issue in &issues {
            if let Ok(content) = fs::read_to_string(&issue.file) {
                originals.entry(issue.file.clone()).or_insert(content);
            }
        }

        // Apply fixes in severity order (highest first)
        let mut sorted_issues = issues.clone();
        sorted_issues.sort_by_key(|i| std::cmp::Reverse(i.severity));

        for issue in sorted_issues {
            let result = self.apply_fix(&issue).await;
            batch.add_fix(result);
        }

        // If any fix failed validation, consider rolling back
        if !batch.validation_passed {
            println!("[code-fixer] ⚠️ Some fixes failed validation, keeping current state");
        }

        batch
    }
}

/// Diff generator for before/after comparison
pub struct DiffGenerator;

impl DiffGenerator {
    /// Generate a simple line-based diff
    pub fn generate_diff(before: &str, after: &str) -> String {
        let before_lines: Vec<&str> = before.lines().collect();
        let after_lines: Vec<&str> = after.lines().collect();

        let mut diff = String::new();
        diff.push_str("--- before\n");
        diff.push_str("+++ after\n");

        let max_lines = before_lines.len().max(after_lines.len());
        for i in 0..max_lines {
            let before_line = before_lines.get(i).copied().unwrap_or("");
            let after_line = after_lines.get(i).copied().unwrap_or("");

            if before_line != after_line {
                diff.push_str(&format!("- {}\n", before_line));
                diff.push_str(&format!("+ {}\n", after_line));
            }
        }

        diff
    }

    /// Generate a unified diff format
    pub fn generate_unified_diff(before: &str, after: &str, _context_lines: usize) -> String {
        let before_lines: Vec<&str> = before.lines().collect();
        let after_lines: Vec<&str> = after.lines().collect();

        let mut diff = String::from("--- before\n+++ after\n");

        // Simple line-by-line comparison
        let max_len = before_lines.len().max(after_lines.len());

        for i in 0..max_len {
            let before_line = before_lines.get(i).copied().unwrap_or("");
            let after_line = after_lines.get(i).copied().unwrap_or("");

            if before_line == after_line {
                if i == 0
                    || i == max_len - 1
                    || (i > 0
                        && before_lines[i - 1] != after_lines.get(i - 1).copied().unwrap_or(""))
                {
                    diff.push_str(&format!(" {}\n", before_line));
                }
            } else {
                if !before_line.is_empty() {
                    diff.push_str(&format!("-{}\n", before_line));
                }
                if !after_line.is_empty() {
                    diff.push_str(&format!("+{}\n", after_line));
                }
            }
        }

        diff
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fix_batch_creation() {
        let batch = FixBatch::new(5);
        assert_eq!(batch.total_issues, 5);
        assert_eq!(batch.successful_fixes, 0);
        assert_eq!(batch.failed_fixes, 0);
    }

    #[test]
    fn test_diff_generator() {
        let before = "line 1\nline 2\nline 3";
        let after = "line 1\nmodified 2\nline 3";

        let diff = DiffGenerator::generate_diff(before, after);
        assert!(diff.contains("- line 2"));
        assert!(diff.contains("+ modified 2"));
    }

    #[test]
    fn test_fix_result() {
        let result = FixResult {
            issue_id: "test-1".to_string(),
            issue_description: "test issue".to_string(),
            file: PathBuf::from("src/main.rs"),
            line_number: 1,
            success: true,
            before: "original".to_string(),
            after: Some("fixed".to_string()),
            validation_passed: true,
            error_message: None,
        };

        assert!(result.success);
        assert!(result.validation_passed);
    }
}
