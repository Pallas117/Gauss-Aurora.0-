use gauss_orchestrator as orchestrator;
use orchestrator::code_indexer::{CodeIssue, IssueSeverity, IssueType};
use orchestrator::multi_agent::{MultiAgentConfig, MultiAgentOrchestrator};
use orchestrator::recursive_solver::RecursiveOrchestrator;
use std::env;
use std::path::PathBuf;

#[tokio::main]
async fn main() -> Result<(), String> {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        println!("Usage: recursive_solver <issue_description> [file_path]");
        return Ok(());
    }

    let description = &args[1];
    let file_path = args
        .get(2)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("README.md"));

    println!("🚀 Starting Recursive Issue Solver...");
    println!("Description: {}", description);
    println!("Target File: {}", file_path.display());

    let ma_config = MultiAgentConfig::from_env();
    let ma_orchestrator = MultiAgentOrchestrator::new(ma_config);
    let recursive_orchestrator = RecursiveOrchestrator::new(ma_orchestrator, 3); // Max depth 3

    let issue = CodeIssue {
        id: "CLI-RECURSIVE-1".to_string(),
        severity: IssueSeverity::Error,
        issue_type: IssueType::MissingErrorHandling, // Default
        file: file_path,
        line_number: 1,
        symbol: None,
        description: description.clone(),
        suggested_fix: "Decompose and solve".to_string(),
        pattern_violated: None,
    };

    match recursive_orchestrator.solve_issue(&issue).await {
        Ok(result) => {
            println!("\n✅ Recursive Resolution Complete!");
            println!("-----------------------------------");
            println!("{}", result);
            println!("-----------------------------------");
            Ok(())
        }
        Err(e) => {
            eprintln!("❌ Error during recursive resolution: {}", e);
            Err(e)
        }
    }
}
