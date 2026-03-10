//! Example: Multi-Agent Orchestration
//!
//! This example demonstrates how to use the GAUSS Orchestrator's multi-agent system
//! to have DeepSeek, Gemini, GPT-4, and Claude collaborate on problem-solving.
//!
//! Run with:
//! ```bash
//! DEEPSEEK_API_KEY="sk-..." \
//! GEMINI_API_KEY="..." \
//! OPENAI_API_KEY="sk-..." \
//! CLAUDE_API_KEY="sk-ant-..." \
//! cargo run --example multi_agent_demo --release
//! ```

use gauss_orchestrator::multi_agent::{MultiAgentConfig, MultiAgentOrchestrator, TaskType};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    // Load configuration from environment
    let config = MultiAgentConfig::from_env();
    let orchestrator = MultiAgentOrchestrator::new(config);

    println!("═══════════════════════════════════════════════════════════════");
    println!("     GAUSS Multi-Agent Orchestration System Demo");
    println!("═══════════════════════════════════════════════════════════════\n");

    // Example 1: Anomaly Detection (Data Analysis)
    println!("1️⃣  EXAMPLE: Analyzing Satellite Telemetry Anomalies");
    println!("─────────────────────────────────────────────────────\n");

    let telemetry = r#"
        Satellite_ID_ALPHA,Timestamp:2026-02-23T10:30:00Z
        Lat:42.5,Lon:-73.2,Altitude:400.2,Signal:WEAK
        Temperature:42C,Voltage:4.2V,Status:DEGRADED
        Anomaly_Flag:True,Variance_3Sigma:2.8
    "#;

    println!("Input Telemetry:\n{}\n", telemetry);

    match orchestrator
        .route_by_task(TaskType::DataAnalysis, telemetry)
        .await
    {
        Ok(result) => {
            println!("Individual Agent Responses:");
            println!("─────────────────────────");
            for agent_result in &result.agent_results {
                println!(
                    "\n📊 {}: ({:.0}% confidence, {:.0}ms)",
                    agent_result.model,
                    agent_result.confidence * 100.0,
                    agent_result.processing_time_ms
                );
                println!("   {}", truncate_response(&agent_result.response, 200));
            }

            println!("\n🎯 Consensus Analysis (Combined):");
            println!("─────────────────────────────────");
            println!("{}\n", result.consensus);

            println!(
                "📈 Overall Confidence: {:.0}%\n",
                result.overall_confidence * 100.0
            );
        }
        Err(e) => {
            println!("❌ Multi-agent analysis failed: {}\n", e);
        }
    }

    // Example 2: Complex Reasoning Task
    println!("\n2️⃣  EXAMPLE: Reasoning Task - System Design");
    println!("───────────────────────────────────────────\n");

    let reasoning_task = "Design a distributed satellite communication system that balances \
         latency, bandwidth, and power consumption. Consider redundancy and \
         failover mechanisms. What are the key trade-offs?";

    println!("Task: {}\n", reasoning_task);

    match orchestrator
        .route_by_task(TaskType::Reasoning, reasoning_task)
        .await
    {
        Ok(result) => {
            println!("Agent Responses ({} agents):", result.agent_results.len());
            println!("────────────────────────\n");

            for (i, agent_result) in result.agent_results.iter().enumerate() {
                println!(
                    "Agent {}: {} ({:.0}% confidence)",
                    i + 1,
                    agent_result.model,
                    agent_result.confidence * 100.0
                );
                println!("  └─ {}\n", truncate_response(&agent_result.response, 150));
            }

            println!("🧠 Synthesized Consensus:");
            println!("──────────────────────");
            println!("{}\n", result.consensus);
        }
        Err(e) => {
            println!("❌ Reasoning task failed: {}\n", e);
        }
    }

    // Example 3: Safety Validation
    println!("3️⃣  EXAMPLE: Safety Check on Anonymized Data");
    println!("──────────────────────────────────────────\n");

    let anonymized_data = r#"
        Asset_123,Timestamp:2026-02-23T10:30:00Z
        Loc_X:42.5,Loc_Y:-73.2,Altitude:400.2
        Temperature:42C,Voltage:4.2V,Status:DEGRADED
    "#;

    let safety_prompt = format!(
        "Verify this data has been properly anonymized and contains no \
         sensitive information:\n{}",
        anonymized_data
    );

    println!("Checking: {}\n", anonymized_data);

    match orchestrator
        .route_by_task(TaskType::SafetyCheck, &safety_prompt)
        .await
    {
        Ok(result) => {
            println!("Safety Validation Results:");
            println!("────────────────────────\n");

            for agent_result in &result.agent_results {
                let status = if agent_result.response.to_lowercase().contains("safe")
                    || agent_result.response.to_lowercase().contains("properly")
                {
                    "✅ SAFE"
                } else {
                    "⚠️  RISK"
                };

                println!("{} - {}", status, agent_result.model);
                println!("   {}\n", truncate_response(&agent_result.response, 150));
            }

            println!("🔒 Overall Safety Assessment:");
            println!("─────────────────────────");
            println!("{}\n", result.consensus);
        }
        Err(e) => {
            println!("❌ Safety check failed: {}\n", e);
        }
    }

    // Example 4: Code Generation
    println!("4️⃣  EXAMPLE: Code Generation Task");
    println!("─────────────────────────────────\n");

    let code_task = "Generate Rust code for a function that reads telemetry CSV files, \
         detects anomalies using 3-sigma rule, and returns a list of \
         anomalous records. Include error handling.";

    println!("Task: {}\n", code_task);

    match orchestrator
        .route_by_task(TaskType::CodeGeneration, code_task)
        .await
    {
        Ok(result) => {
            println!(
                "Code Generation Results ({} agents):",
                result.agent_results.len()
            );
            println!("──────────────────────────────────\n");

            for (i, agent_result) in result.agent_results.iter().enumerate() {
                println!(
                    "Approach {}: {} ({:.0}% confidence)",
                    i + 1,
                    agent_result.model,
                    agent_result.confidence * 100.0
                );
                println!("  └─ {}\n", truncate_response(&agent_result.response, 150));
            }

            println!("💡 Recommended Implementation:");
            println!("──────────────────────────");
            println!("{}\n", result.consensus);
        }
        Err(e) => {
            println!("❌ Code generation failed: {}\n", e);
        }
    }

    println!("═══════════════════════════════════════════════════════════════");
    println!("Demo Complete! Multi-agent orchestration successful.");
    println!("═══════════════════════════════════════════════════════════════");

    Ok(())
}

/// Truncate response to a maximum length with ellipsis
fn truncate_response(text: &str, max_len: usize) -> String {
    if text.len() <= max_len {
        text.to_string()
    } else {
        format!("{}...", &text[..max_len])
    }
}
