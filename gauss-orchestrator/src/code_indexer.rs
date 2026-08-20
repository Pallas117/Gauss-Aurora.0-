use regex::Regex;
use serde::{Deserialize, Serialize};
/// Code Indexing System for Autonomous Code Analysis
/// Indexes Rust source code to enable semantic analysis by AI agents
///
/// This module provides:
/// - Symbol extraction (functions, types, structs, enums)
/// - Error handling pattern detection
/// - Configuration pattern recognition
/// - Dependency and usage tracking
/// - Integration points for multi-agent analysis
use std::fs;
use std::path::{Path, PathBuf};

/// Represents a discovered code symbol (function, type, etc.)
#[derive(Debug, Clone)]
pub struct CodeSymbol {
    pub name: String,
    pub symbol_type: SymbolType,
    pub file: PathBuf,
    pub line_number: usize,
    pub signature: String,
    pub documentation: Option<String>,
    pub error_handling: Vec<String>,
    pub is_tested: bool,
}

/// Type of code symbol
#[derive(Debug, Clone, PartialEq)]
pub enum SymbolType {
    Function,
    Struct,
    Enum,
    Trait,
    Module,
    ConfigStruct,
    ErrorType,
}

impl std::fmt::Display for SymbolType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SymbolType::Function => write!(f, "fn"),
            SymbolType::Struct => write!(f, "struct"),
            SymbolType::Enum => write!(f, "enum"),
            SymbolType::Trait => write!(f, "trait"),
            SymbolType::Module => write!(f, "mod"),
            SymbolType::ConfigStruct => write!(f, "config"),
            SymbolType::ErrorType => write!(f, "error"),
        }
    }
}

/// Serde helper: PathBuf as string for JSON persist/load (e.g. work-queue-issues.json).
mod path_serde {
    use serde::{Deserialize, Deserializer, Serializer};
    use std::path::{Path, PathBuf};
    pub fn serialize<S>(path: &Path, s: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        s.serialize_str(&path.to_string_lossy())
    }
    pub fn deserialize<'de, D>(d: D) -> Result<PathBuf, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(d)?;
        Ok(PathBuf::from(s))
    }
}

/// Represents a code issue discovered during analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeIssue {
    pub id: String,
    pub severity: IssueSeverity,
    pub issue_type: IssueType,
    #[serde(with = "path_serde")]
    pub file: PathBuf,
    pub line_number: usize,
    pub symbol: Option<String>,
    pub description: String,
    pub suggested_fix: String,
    pub pattern_violated: Option<String>,
}

/// Severity of a code issue
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Copy, Serialize, Deserialize)]
pub enum IssueSeverity {
    Info,
    Warning,
    Error,
    Critical,
}

impl std::fmt::Display for IssueSeverity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IssueSeverity::Info => write!(f, "ℹ️ info"),
            IssueSeverity::Warning => write!(f, "⚠️ warning"),
            IssueSeverity::Error => write!(f, "❌ error"),
            IssueSeverity::Critical => write!(f, "🔴 critical"),
        }
    }
}

/// Type of issue detected
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum IssueType {
    UnusedImport,
    MissingErrorHandling,
    TypeMismatch,
    UntestablePath,
    ConfigViolation,
    PerformanceIssue,
    SecurityConcern,
    DocumentationMissing,
    NamingViolation,
}

impl std::fmt::Display for IssueType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IssueType::UnusedImport => write!(f, "unused import"),
            IssueType::MissingErrorHandling => write!(f, "missing error handling"),
            IssueType::TypeMismatch => write!(f, "type mismatch"),
            IssueType::UntestablePath => write!(f, "untestable path"),
            IssueType::ConfigViolation => write!(f, "config violation"),
            IssueType::PerformanceIssue => write!(f, "performance issue"),
            IssueType::SecurityConcern => write!(f, "security concern"),
            IssueType::DocumentationMissing => write!(f, "documentation missing"),
            IssueType::NamingViolation => write!(f, "naming violation"),
        }
    }
}

/// Complete index of a Rust codebase
#[derive(Debug, Clone)]
pub struct CodebaseIndex {
    pub symbols: Vec<CodeSymbol>,
    pub files_indexed: usize,
    pub total_lines: usize,
    pub error_types: Vec<String>,
    pub config_patterns: Vec<String>,
    pub test_coverage: TestCoverage,
}

/// Test coverage summary
#[derive(Debug, Clone)]
pub struct TestCoverage {
    pub total_symbols: usize,
    pub tested_symbols: usize,
    pub coverage_percent: f64,
}

impl CodebaseIndex {
    /// Merge multiple indices into one (e.g. from multiple scan roots).
    pub fn merge(indices: Vec<CodebaseIndex>) -> CodebaseIndex {
        if indices.is_empty() {
            return CodebaseIndex {
                symbols: Vec::new(),
                files_indexed: 0,
                total_lines: 0,
                error_types: Vec::new(),
                config_patterns: Vec::new(),
                test_coverage: TestCoverage {
                    total_symbols: 0,
                    tested_symbols: 0,
                    coverage_percent: 100.0,
                },
            };
        }
        let mut symbols = Vec::new();
        let mut files_indexed = 0;
        let mut total_lines = 0;
        let mut error_types = Vec::new();
        let mut config_patterns = Vec::new();
        for idx in indices {
            symbols.extend(idx.symbols);
            files_indexed += idx.files_indexed;
            total_lines += idx.total_lines;
            error_types.extend(idx.error_types);
            config_patterns.extend(idx.config_patterns);
        }
        let total_symbols = symbols.len();
        let tested_symbols = symbols.iter().filter(|s| s.is_tested).count();
        let coverage_percent = if total_symbols == 0 {
            100.0
        } else {
            (tested_symbols as f64 / total_symbols as f64) * 100.0
        };
        CodebaseIndex {
            symbols,
            files_indexed,
            total_lines,
            error_types,
            config_patterns,
            test_coverage: TestCoverage {
                total_symbols,
                tested_symbols,
                coverage_percent,
            },
        }
    }
}

/// Main indexer for analyzing Rust codebases
pub struct CodeIndexer {
    src_path: PathBuf,
    symbols: Vec<CodeSymbol>,
    files_indexed: usize,
    total_lines: usize,
}

impl CodeIndexer {
    /// Create a new indexer for the given source directory
    pub fn new(src_path: impl AsRef<Path>) -> Self {
        Self {
            src_path: src_path.as_ref().to_path_buf(),
            symbols: Vec::new(),
            files_indexed: 0,
            total_lines: 0,
        }
    }

    /// Index the entire codebase
    pub async fn index_codebase(&mut self) -> Result<CodebaseIndex, String> {
        println!("[code-indexer] 🔍 Starting codebase indexing...");

        self.index_directory(&self.src_path.clone())?;

        let tested_count = self.symbols.iter().filter(|s| s.is_tested).count();
        let coverage_percent = if self.symbols.is_empty() {
            100.0
        } else {
            (tested_count as f64 / self.symbols.len() as f64) * 100.0
        };

        let error_types = self.extract_error_types();
        let config_patterns = self.extract_config_patterns();

        println!(
            "[code-indexer] ✅ Indexed {} files, {} symbols, {:.1}% test coverage",
            self.files_indexed,
            self.symbols.len(),
            coverage_percent
        );

        Ok(CodebaseIndex {
            symbols: self.symbols.clone(),
            files_indexed: self.files_indexed,
            total_lines: self.total_lines,
            error_types,
            config_patterns,
            test_coverage: TestCoverage {
                total_symbols: self.symbols.len(),
                tested_symbols: tested_count,
                coverage_percent,
            },
        })
    }

    /// Index a directory recursively
    fn index_directory(&mut self, dir: &Path) -> Result<(), String> {
        let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;

        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();

            if path.is_dir() {
                let name = path.file_name().unwrap().to_string_lossy();
                if !name.starts_with('.') && name != "target" {
                    self.index_directory(&path)?;
                }
            } else if path.extension().map(|e| e == "rs").unwrap_or(false) {
                self.index_file(&path)?;
            }
        }

        Ok(())
    }

    /// Index a single Rust file
    fn index_file(&mut self, file: &Path) -> Result<(), String> {
        let content = fs::read_to_string(file).map_err(|e| e.to_string())?;
        let lines: Vec<&str> = content.lines().collect();

        self.files_indexed += 1;
        self.total_lines += lines.len();

        let file_path = file.to_path_buf();

        // Extract functions
        self.extract_functions(&file_path, &content, &lines);

        // Extract types
        self.extract_types(&file_path, &content, &lines);

        // Extract error types
        self.extract_error_defs(&file_path, &content, &lines);

        // Extract config structs
        self.extract_config_structs(&file_path, &content, &lines);

        Ok(())
    }

    /// Extract function symbols from file content
    fn extract_functions(&mut self, file: &Path, content: &str, lines: &[&str]) {
        let fn_regex = Regex::new(r#"(?m)^pub\s+(?:async\s+)?fn\s+(\w+)\s*(\([^)]*\))"#)
            .expect("Invalid regex");

        for (line_num, line) in lines.iter().enumerate() {
            if let Some(caps) = fn_regex.captures(line) {
                let name: String = caps.get(1).expect("capture group 1").as_str().to_string();
                let signature = format!("fn {}{}", &name, caps.get(2).unwrap().as_str());

                // Check for error handling
                let error_handling = self.analyze_error_handling(content, &name);

                // Check if tested
                let is_tested = self.is_function_tested(content, &name);

                // Extract documentation
                let doc = self.extract_documentation(lines, line_num);

                self.symbols.push(CodeSymbol {
                    name: name.clone(),
                    symbol_type: SymbolType::Function,
                    file: file.to_path_buf(),
                    line_number: line_num + 1,
                    signature,
                    documentation: doc,
                    error_handling,
                    is_tested,
                });
            }
        }
    }

    /// Extract struct and enum type symbols
    fn extract_types(&mut self, file: &Path, content: &str, lines: &[&str]) {
        let struct_regex =
            Regex::new(r#"(?m)^(?:pub\s+)?(?:#\[.*?\])?\s*(?:pub\s+)?(?:struct|enum)\s+(\w+)"#)
                .expect("Invalid regex");

        for (line_num, line) in lines.iter().enumerate() {
            if let Some(caps) = struct_regex.captures(line) {
                let name: String = caps.get(1).expect("capture group 1").as_str().to_string();
                let symbol_type = if line.contains("enum") {
                    SymbolType::Enum
                } else {
                    SymbolType::Struct
                };

                let doc = self.extract_documentation(lines, line_num);
                let is_tested = self.is_type_tested(content, &name);

                self.symbols.push(CodeSymbol {
                    name: name.clone(),
                    symbol_type,
                    file: file.to_path_buf(),
                    line_number: line_num + 1,
                    signature: String::new(),
                    documentation: doc,
                    error_handling: Vec::new(),
                    is_tested,
                });
            }
        }
    }

    /// Extract error type definitions
    fn extract_error_defs(&mut self, file: &Path, content: &str, lines: &[&str]) {
        let error_regex = Regex::new(r#"(?:pub\s+)?(?:enum|struct)\s+(\w+(?:Error|Err)\w*)"#)
            .expect("Invalid regex");

        for (line_num, line) in lines.iter().enumerate() {
            if let Some(caps) = error_regex.captures(line) {
                let name: String = caps.get(1).expect("capture group 1").as_str().to_string();
                let is_tested = self.is_type_tested(content, &name);

                self.symbols.push(CodeSymbol {
                    name,
                    symbol_type: SymbolType::ErrorType,
                    file: file.to_path_buf(),
                    line_number: line_num + 1,
                    signature: String::new(),
                    documentation: self.extract_documentation(lines, line_num),
                    error_handling: Vec::new(),
                    is_tested,
                });
            }
        }
    }

    /// Extract config struct patterns
    fn extract_config_structs(&mut self, file: &Path, _content: &str, lines: &[&str]) {
        let config_regex =
            Regex::new(r#"(?:pub\s+)?(?:struct|fn)\s+(\w*[Cc]onfig\w*)"#).expect("Invalid regex");

        for (line_num, line) in lines.iter().enumerate() {
            if let Some(caps) = config_regex.captures(line) {
                let name: String = caps.get(1).expect("capture group 1").as_str().to_string();

                self.symbols.push(CodeSymbol {
                    name,
                    symbol_type: SymbolType::ConfigStruct,
                    file: file.to_path_buf(),
                    line_number: line_num + 1,
                    signature: String::new(),
                    documentation: self.extract_documentation(lines, line_num),
                    error_handling: Vec::new(),
                    is_tested: true, // Config usually tested
                });
            }
        }
    }

    /// Analyze error handling patterns in a function
    fn analyze_error_handling(&self, content: &str, fn_name: &str) -> Vec<String> {
        let mut patterns = Vec::new();

        if content.contains(&format!("{}(", fn_name)) {
            if content.contains("?") {
                patterns.push("question mark operator".to_string());
            }
            if content.contains("unwrap") {
                patterns.push("unwrap".to_string());
            }
            if content.contains("expect") {
                patterns.push("expect".to_string());
            }
            if content.contains(".map_err") {
                patterns.push("map_err".to_string());
            }
            if content.contains("match") {
                patterns.push("pattern matching".to_string());
            }
        }

        patterns
    }

    /// Check if a function has tests
    fn is_function_tested(&self, content: &str, fn_name: &str) -> bool {
        content.contains(&format!("fn test_{}", fn_name))
            || content.contains("#[test]") && content.contains(&format!("{}(", fn_name))
    }

    /// Check if a type has tests
    fn is_type_tested(&self, content: &str, type_name: &str) -> bool {
        content.contains(&format!("test_{}", type_name.to_lowercase()))
            || (content.contains("#[test]") && content.contains(&format!("{}::", type_name)))
    }

    /// Extract documentation comment for a symbol
    fn extract_documentation(&self, lines: &[&str], line_num: usize) -> Option<String> {
        let mut doc = String::new();

        // Look backwards for doc comments
        let mut i = line_num as i32 - 1;
        while i >= 0 {
            let line = lines[i as usize].trim();
            if line.starts_with("///") {
                doc.insert_str(0, &format!("{}\n", line));
                i -= 1;
            } else if line.is_empty() {
                i -= 1;
            } else {
                break;
            }
        }

        if doc.is_empty() {
            None
        } else {
            Some(doc)
        }
    }

    /// Extract all error type definitions
    fn extract_error_types(&self) -> Vec<String> {
        self.symbols
            .iter()
            .filter(|s| s.symbol_type == SymbolType::ErrorType)
            .map(|s| s.name.clone())
            .collect()
    }

    /// Extract all config patterns
    fn extract_config_patterns(&self) -> Vec<String> {
        self.symbols
            .iter()
            .filter(|s| s.symbol_type == SymbolType::ConfigStruct)
            .map(|s| s.name.clone())
            .collect()
    }
}

/// Index multiple directory roots (e.g. ./src, ./gauss-orchestrator/src) and merge into one CodebaseIndex.
/// Roots are read from ORCHESTRATOR_SCAN_ROOTS (comma-separated) or default to ["./src", "./gauss-orchestrator/src"].
pub fn scan_roots_from_env() -> Vec<PathBuf> {
    let default = "./src,./gauss-orchestrator/src";
    let s = std::env::var("ORCHESTRATOR_SCAN_ROOTS").unwrap_or_else(|_| default.to_string());
    s.split(',')
        .map(|p| PathBuf::from(p.trim()))
        .filter(|p| !p.as_os_str().is_empty())
        .collect()
}

/// Index multiple roots and merge results. Skips roots that do not exist.
pub async fn index_multiple_roots(roots: &[PathBuf]) -> Result<CodebaseIndex, String> {
    let mut indices = Vec::new();
    for root in roots {
        if !root.exists() {
            continue;
        }
        let mut indexer = CodeIndexer::new(root);
        let idx = indexer.index_codebase().await?;
        indices.push(idx);
    }
    if indices.is_empty() {
        return Err("No valid scan roots (ORCHESTRATOR_SCAN_ROOTS)".to_string());
    }
    Ok(CodebaseIndex::merge(indices))
}

/// Code analyzer that uses the index to find issues
pub struct CodeAnalyzer {
    index: CodebaseIndex,
}

impl CodeAnalyzer {
    /// Create analyzer from index
    pub fn new(index: CodebaseIndex) -> Self {
        Self { index }
    }

    /// Analyze code and find issues
    pub fn analyze(&self) -> Vec<CodeIssue> {
        let mut issues = Vec::new();

        // Check test coverage
        issues.extend(self.check_test_coverage());

        // Check error handling
        issues.extend(self.check_error_handling());

        // Check naming conventions
        issues.extend(self.check_naming_conventions());

        // Check documentation
        issues.extend(self.check_documentation());

        issues.sort_by_key(|i| std::cmp::Reverse(i.severity));
        issues
    }

    /// Check test coverage for symbols
    fn check_test_coverage(&self) -> Vec<CodeIssue> {
        let mut issues = Vec::new();
        let threshold = 0.80; // 80% coverage minimum

        if self.index.test_coverage.coverage_percent < threshold * 100.0 {
            issues.push(CodeIssue {
                id: "coverage-low".to_string(),
                severity: IssueSeverity::Warning,
                issue_type: IssueType::UntestablePath,
                file: PathBuf::from("src/"),
                line_number: 0,
                symbol: None,
                description: format!(
                    "Test coverage at {:.1}% (target: {:.0}%)",
                    self.index.test_coverage.coverage_percent,
                    threshold * 100.0
                ),
                suggested_fix: "Add tests for uncovered symbols".to_string(),
                pattern_violated: Some("gauss_aurora_testing_standard".to_string()),
            });
        }

        // Check individual untested symbols
        for symbol in &self.index.symbols {
            if !symbol.is_tested && matches!(symbol.symbol_type, SymbolType::Function) {
                issues.push(CodeIssue {
                    id: format!("untested-{}", symbol.name),
                    severity: IssueSeverity::Warning,
                    issue_type: IssueType::UntestablePath,
                    file: symbol.file.clone(),
                    line_number: symbol.line_number,
                    symbol: Some(symbol.name.clone()),
                    description: format!("Function '{}' has no test", symbol.name),
                    suggested_fix: format!(
                        "#[test]\nfn test_{}() {{\n    // TODO: implement test\n}}",
                        symbol.name
                    ),
                    pattern_violated: Some("missing_test".to_string()),
                });
            }
        }

        issues
    }

    /// Check error handling patterns
    fn check_error_handling(&self) -> Vec<CodeIssue> {
        let mut issues = Vec::new();

        for symbol in &self.index.symbols {
            if symbol.symbol_type == SymbolType::Function && symbol.error_handling.is_empty() {
                // Function might need error handling
                if symbol.signature.contains("Result") {
                    issues.push(CodeIssue {
                        id: format!("no-error-handling-{}", symbol.name),
                        severity: IssueSeverity::Warning,
                        issue_type: IssueType::MissingErrorHandling,
                        file: symbol.file.clone(),
                        line_number: symbol.line_number,
                        symbol: Some(symbol.name.clone()),
                        description: format!(
                            "Function '{}' returns Result but may lack proper error handling",
                            symbol.name
                        ),
                        suggested_fix: "Add explicit error handling with .map_err() or match"
                            .to_string(),
                        pattern_violated: Some("gauss_aurora_error_handling".to_string()),
                    });
                }
            }
        }

        issues
    }

    /// Check naming conventions
    fn check_naming_conventions(&self) -> Vec<CodeIssue> {
        let mut issues = Vec::new();

        for symbol in &self.index.symbols {
            // Check for snake_case in function names
            if symbol.symbol_type == SymbolType::Function
                && symbol.name.contains('_')
                && !symbol.name.chars().all(|c| c.is_lowercase() || c == '_')
            {
                issues.push(CodeIssue {
                    id: format!("naming-{}", symbol.name),
                    severity: IssueSeverity::Info,
                    issue_type: IssueType::NamingViolation,
                    file: symbol.file.clone(),
                    line_number: symbol.line_number,
                    symbol: Some(symbol.name.clone()),
                    description: format!("Function '{}' should use snake_case", symbol.name),
                    suggested_fix: format!("Rename to: {}", symbol.name.to_lowercase()),
                    pattern_violated: Some("rust_naming_conventions".to_string()),
                });
            }

            // Check for PascalCase in struct/type names
            if matches!(symbol.symbol_type, SymbolType::Struct | SymbolType::Enum)
                && !symbol.name.chars().next().unwrap_or('a').is_uppercase()
            {
                issues.push(CodeIssue {
                    id: format!("naming-{}", symbol.name),
                    severity: IssueSeverity::Info,
                    issue_type: IssueType::NamingViolation,
                    file: symbol.file.clone(),
                    line_number: symbol.line_number,
                    symbol: Some(symbol.name.clone()),
                    description: format!("Type '{}' should use PascalCase", symbol.name),
                    suggested_fix: format!(
                        "Rename to: {}",
                        symbol
                            .name
                            .chars()
                            .next()
                            .unwrap()
                            .to_uppercase()
                            .to_string()
                            + &symbol.name[1..]
                    ),
                    pattern_violated: Some("rust_naming_conventions".to_string()),
                });
            }
        }

        issues
    }

    /// Check documentation completeness
    fn check_documentation(&self) -> Vec<CodeIssue> {
        let mut issues = Vec::new();

        for symbol in &self.index.symbols {
            if matches!(
                symbol.symbol_type,
                SymbolType::Function | SymbolType::Struct
            ) && symbol.documentation.is_none()
            {
                issues.push(CodeIssue {
                    id: format!("doc-missing-{}", symbol.name),
                    severity: IssueSeverity::Info,
                    issue_type: IssueType::DocumentationMissing,
                    file: symbol.file.clone(),
                    line_number: symbol.line_number,
                    symbol: Some(symbol.name.clone()),
                    description: format!("'{}' lacks documentation comment", symbol.name),
                    suggested_fix: format!("/// Add documentation comment above {}", symbol.name),
                    pattern_violated: Some("documentation_standard".to_string()),
                });
            }
        }

        issues
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_symbol_type_display() {
        assert_eq!(SymbolType::Function.to_string(), "fn");
        assert_eq!(SymbolType::Struct.to_string(), "struct");
        assert_eq!(SymbolType::ErrorType.to_string(), "error");
    }

    #[test]
    fn test_issue_severity_ordering() {
        assert!(IssueSeverity::Critical > IssueSeverity::Error);
        assert!(IssueSeverity::Error > IssueSeverity::Warning);
        assert!(IssueSeverity::Warning > IssueSeverity::Info);
    }

    #[test]
    fn test_code_indexer_new() {
        let indexer = CodeIndexer::new("./src");
        assert_eq!(indexer.files_indexed, 0);
        assert_eq!(indexer.symbols.len(), 0);
    }
}
