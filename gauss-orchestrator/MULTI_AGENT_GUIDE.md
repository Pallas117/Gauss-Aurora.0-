# Multi-Agent AI Orchestration Guide

This guide explains how to use Rust to orchestrate collaboration between multiple AI models (DeepSeek, Gemini, GPT-4, Claude) to solve complex problems in the GAUSS Orchestrator.

## Overview

The **Multi-Agent Orchestrator** allows you to:
- Route tasks to specialized AI models based on problem type
- Execute multiple models in parallel for faster results
- Synthesize consensus from competing analyses
- Leverage each model's unique strengths

### Model Strengths

| Model | Strengths | Best For |
|-------|-----------|----------|
| **DeepSeek** | Deep reasoning, mathematical analysis, novel approaches | Complex reasoning, anomaly detection |
| **Gemini** | Fast semantic understanding, multimodal processing | Quick comprehension, image analysis |
| **GPT-4** | General intelligence, code generation, writing | Code, synthesis, diverse tasks |
| **Claude** | Instruction-following, safety/alignment, nuanced analysis | Safety checks, detailed analysis |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Telemetry Input                            │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │  Task Type Classification     │
         │  (Reasoning, Code, Safety,    │
         │   Comprehension, DataAnalysis)│
         └────────┬────────────────────┬─┘
                  │                    │
        ┌─────────▼──────────┐   ┌─────▼──────────┐
        │  Select Agents     │   │  Parallel      │
        │  for Task Type     │   │  Execution     │
        └─────────┬──────────┘   └─────┬──────────┘
                  │                    │
    ┌─────────────┼─────────────┬──────┼──────────┬──────────┐
    │             │             │      │          │          │
    ▼             ▼             ▼      ▼          ▼          ▼
  DeepSeek     Gemini        GPT-4   Claude   Agents in Parallel
    
    │             │             │      │          │          │
    └─────────────┼─────────────┼──────┼──────────┴──────────┘
                  │             │      │
                  ▼             ▼      ▼
            ┌─────────────────────────────────┐
            │  Collect Agent Results          │
            │  (response, confidence, timing) │
            └────────────┬────────────────────┘
                         │
                         ▼
            ┌─────────────────────────────────┐
            │  Synthesize Consensus           │
            │  (use GPT-4 or Claude)          │
            └────────────┬────────────────────┘
                         │
                         ▼
            ┌─────────────────────────────────┐
            │  Final Multi-Agent Result       │
            │  - All agent responses          │
            │  - Consensus summary            │
            │  - Overall confidence           │
            └─────────────────────────────────┘
```

## Environment Variables

Set these variables to enable each model:

```bash
# DeepSeek (required for local reasoning tasks)
export ORCHESTRATOR_LOCAL_ENGINE_API_KEY="your-deepseek-api-key"
export ORCHESTRATOR_LOCAL_ENGINE_URL="https://api.deepseek.com/chat/completions"

# Google Gemini (for fast comprehension)
export GEMINI_API_KEY="your-gemini-key"

# OpenAI GPT-4 (for code generation and synthesis)
export OPENAI_API_KEY="sk-..."  # or ORCHESTRATOR_OPENAI_API_KEY

# Anthropic Claude (for safety and instruction-following)
export CLAUDE_API_KEY="sk-ant-..."  # or ANTHROPIC_API_KEY

# Optional: HTTP timeout (default 8 seconds)
export ORCHESTRATOR_HTTP_TIMEOUT_SECONDS=15
```

## Usage Examples

### Example 1: Analyze Telemetry with Multi-Agent Reasoning

```rust
use gauss_orchestrator::multi_agent::{
    MultiAgentOrchestrator, MultiAgentConfig, TaskType,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = MultiAgentConfig::from_env();
    let orchestrator = MultiAgentOrchestrator::new(config);

    let telemetry = r#"
        Satellite_ID_001,Lat:42.5,Lon:-73.2,Signal:WEAK,Anomaly:True
        Timestamp:2026-02-23T10:30:00Z,Status:DEGRADED
    "#;

    // Route to specialized agents for data analysis
    let result = orchestrator
        .route_by_task(TaskType::DataAnalysis, telemetry)
        .await?;

    println!("Agent Results:");
    for agent_result in &result.agent_results {
        println!(
            "  {}: Confidence {:.0}% ({:.0}ms)\n    {}",
            agent_result.model,
            agent_result.confidence * 100.0,
            agent_result.processing_time_ms,
            agent_result.response
        );
    }

    println!("\nConsensus Analysis:");
    println!("{}", result.consensus);
    println!("Overall Confidence: {:.0}%", result.overall_confidence * 100.0);

    Ok(())
}
```

### Example 2: Multi-Agent Code Review and Bug Detection

```rust
let code_snippet = r#"
    fn process_telemetry(data: &str) -> String {
        let parts: Vec<&str> = data.split(',').collect();
        let satellite_id = parts[0];  // Potential panic: no bounds check
        format!("Processed: {}", satellite_id)
    }
"#;

// DeepSeek + Claude for different code review perspectives
let result = orchestrator
    .route_by_task(TaskType::CodeGeneration, code_snippet)
    .await?;

// DeepSeek might find logical issues
// Claude might focus on safety and best practices
// GPT-4 synthesizes both perspectives
```

### Example 3: Safety Check with Consensus Voting

```rust
let suspicious_content = "CLASSIFIED military satellite coordinates";

// Route to safety-focused agents (Claude + GPT-4)
let result = orchestrator
    .route_by_task(TaskType::SafetyCheck, suspicious_content)
    .await?;

// Claude: "This contains classified military information..."
// GPT-4: "Flag as HIGH sensitivity - contains CLASSIFIED keyword..."
// Consensus: "DEFINITE SAFETY ISSUE - Route to local DeepSeek only"
```

## Task Types and Agent Selection

### TaskType::Reasoning
**Best For**: Complex mathematical analysis, anomaly detection, strategic decisions

**Selected Agents**: DeepSeek, GPT-4

```rust
// Example: Analyzing a complex pattern in satellite data
let analysis_task = "Identify patterns in 6-month satellite telemetry variance";
let result = orchestrator.route_by_task(TaskType::Reasoning, analysis_task).await?;
```

### TaskType::CodeGeneration
**Best For**: Writing, reviewing, debugging code

**Selected Agents**: GPT-4, Claude, DeepSeek

```rust
// Example: Generate test cases for a routing function
let code_task = "Generate comprehensive test cases for async HTTP routing";
let result = orchestrator.route_by_task(TaskType::CodeGeneration, code_task).await?;
```

### TaskType::Comprehension
**Best For**: Understanding documents, summarizing, quick analysis

**Selected Agents**: Gemini, Claude

```rust
// Example: Summarize system logs
let comprehension_task = "Summarize these orchestrator logs and highlight issues";
let result = orchestrator.route_by_task(TaskType::Comprehension, logs).await?;
```

### TaskType::SafetyCheck
**Best For**: Content moderation, alignment verification, policy enforcement

**Selected Agents**: Claude, GPT-4

```rust
// Example: Verify no sensitive data in anonymized telemetry
let safety_task = format!("Check if this is truly anonymized:\n{}", anonymized_data);
let result = orchestrator.route_by_task(TaskType::SafetyCheck, &safety_task).await?;
```

### TaskType::DataAnalysis
**Best For**: Statistical analysis, pattern matching, comprehensive data review

**Selected Agents**: DeepSeek, GPT-4, Gemini

```rust
// Example: Deep telemetry analysis
let data_task = "Analyze this telemetry for outliers, trends, and anomalies";
let result = orchestrator.route_by_task(TaskType::DataAnalysis, telemetry).await?;
```

## Consensus Synthesis

After all agents process the task, the orchestrator **synthesizes a consensus** using GPT-4 or Claude:

### Synthesis Process
1. Collect individual agent responses
2. Build synthesis prompt with all perspectives
3. Route to synthesis model (GPT-4 or Claude)
4. Return unified consensus

**Example Synthesis Prompt**:
```
Original task:
  Analyze this anomalous telemetry

Responses from different AI models:
DeepSeek: [mathematical analysis of variance and pattern...]
GPT-4: [general assessment of anomaly severity...]
Claude: [safety-focused analysis of potential issues...]

Synthesize a consensus response that combines the best insights from all models.
```

## Parallel Execution & Performance

The multi-agent orchestrator executes all selected agents **in parallel** using Tokio:

```rust
// All agents process simultaneously
let handles: Vec<_> = models
    .iter()
    .map(|model| tokio::spawn(process_agent(model)))
    .collect();
```

**Performance Characteristics**:
- **Single Agent**: ~1-5 seconds (network latency + processing)
- **3 Agents Parallel**: ~2-5 seconds (bottleneck is slowest agent, not sum)
- **5 Agents Parallel**: ~3-6 seconds (same pattern)

### Example Timing
```json
{
  "agent_results": [
    {"model": "DeepSeek", "processing_time_ms": 2100},
    {"model": "GPT-4", "processing_time_ms": 1800},
    {"model": "Claude", "processing_time_ms": 2400}
  ],
  "total_wall_time_ms": 2600,
  "comment": "All 3 run in parallel, so total = slowest (2400ms) + overhead"
}
```

## Integration with Orchestrator Main Loop

Add multi-agent analysis to sensitivity-detected telemetry:

```rust
// In src/main.rs, after sensitivity detection
match sensitivity {
    Sensitivity::High => {
        // Existing: route to local DeepSeek
        route_to_local(&client, &data, &config).await?;
        
        // NEW: Get additional multi-agent insights
        if std::env::var("ORCHESTRATOR_MULTI_AGENT").is_ok() {
            let ma_config = MultiAgentConfig::from_env();
            let ma_orchestrator = MultiAgentOrchestrator::new(ma_config);
            
            let analysis = ma_orchestrator
                .route_by_task(TaskType::DataAnalysis, &data)
                .await?;
            
            println!("Multi-Agent Consensus:\n{}", analysis.consensus);
        }
    }
    Sensitivity::Low => {
        // Existing: route to cloud (anonymized)
        route_to_cloud(&client, &data, &config).await?;
    }
}
```

## Cost Optimization

### Per-API-Call Pricing (Approximate, Feb 2026)

| Model | Input Cost | Output Cost | Best Use |
|-------|-----------|------------|----------|
| DeepSeek | $0.14/M | $0.28/M | Specialized reasoning |
| Gemini | $0.075/M | $0.3/M | Quick analysis |
| GPT-4 | $0.03/M | $0.06/M | Synthesis |
| Claude | $0.003/M | $0.015/M | Safety checks |

### Cost Reduction Strategies

1. **Selective Multi-Agent Routing**:
   - Only use multi-agent for HIGH-sensitivity telemetry
   - Single-agent for LOW-sensitivity

2. **Task-Specific Selection**:
   - Use cheapest models for simple tasks
   - Reserve expensive models for complex reasoning

3. **Caching**:
   ```rust
   // Future: Cache consensus results for identical inputs
   let hash = compute_hash(input);
   if let Some(cached) = consensus_cache.get(&hash) {
       return cached.clone();
   }
   ```

4. **Batch Processing**:
   ```rust
   // Process multiple telemetry files together
   let batch_task = format!("Analyze all these telemetry samples:\n{}", all_data);
   orchestrator.route_by_task(TaskType::DataAnalysis, &batch_task).await?;
   ```

## Error Handling & Graceful Degradation

The orchestrator **gracefully degrades** if some agents are unavailable:

```rust
// If an API key is missing:
if config.deepseek_api_key.is_none() {
    tracing::warn!("DeepSeek not configured; skipping reasoner");
    // Continue with remaining agents
}

// If a request times out:
match handle.await {
    Ok(Ok(result)) => { /* success */ }
    Ok(Err(e)) => {
        tracing::warn!(error = %e, "agent failed; using other results");
        // Continue with results from other agents
    }
    Err(_) => {
        tracing::warn!("agent task cancelled");
        // Skip this agent's result
    }
}
```

## Testing

### Unit Tests

```bash
# Test task routing selection
cargo test test_task_type_routing_reasoning

# Test agent model display
cargo test test_agent_model_display

# Test config loading
cargo test test_multi_agent_config_from_env
```

### Integration Tests (with Real APIs)

```bash
# Requires all API keys set
DEEPSEEK_API_KEY="sk-..." \
GEMINI_API_KEY="..." \
OPENAI_API_KEY="sk-..." \
CLAUDE_API_KEY="sk-ant-..." \
cargo test --test multi_agent_integration -- --nocapture
```

## Advanced: Custom Agent Orchestration

Implement custom agent routing logic:

```rust
pub async fn custom_telemetry_analysis(
    orchestrator: &MultiAgentOrchestrator,
    telemetry: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    // Step 1: Quick safety check with Claude
    let safety = orchestrator
        .route_by_task(TaskType::SafetyCheck, telemetry)
        .await?;
    
    if safety.consensus.contains("UNSAFE") {
        return Ok(format!("Blocked: {}", safety.consensus));
    }
    
    // Step 2: Deep analysis with reasoning agents
    let analysis = orchestrator
        .route_by_task(TaskType::DataAnalysis, telemetry)
        .await?;
    
    // Step 3: Code generation for report
    let report_prompt = format!(
        "Create a detailed report from this analysis:\n{}",
        analysis.consensus
    );
    
    let report = orchestrator
        .route_by_task(TaskType::CodeGeneration, &report_prompt)
        .await?;
    
    Ok(report.consensus)
}
```

## Configuration Checklist

- [ ] Set `ORCHESTRATOR_LOCAL_ENGINE_API_KEY` for DeepSeek
- [ ] Set `GEMINI_API_KEY` (optional, for fast analysis)
- [ ] Set `OPENAI_API_KEY` (optional, for synthesis)
- [ ] Set `CLAUDE_API_KEY` (optional, for safety checks)
- [ ] Set `ORCHESTRATOR_HTTP_TIMEOUT_SECONDS` if needed
- [ ] Enable logging: `export RUST_LOG=info`
- [ ] Test with: `cargo test multi_agent`
- [ ] Monitor costs: track API usage in console logs

## Troubleshooting

### All agents fail
```
Error: No agents produced valid results
```
**Fix**: Check API keys are set correctly:
```bash
echo $ORCHESTRATOR_LOCAL_ENGINE_API_KEY
echo $OPENAI_API_KEY
```

### Consensus synthesis fails
```
Error: Unable to synthesize consensus: no synthesis model configured
```
**Fix**: Set either `OPENAI_API_KEY` or `CLAUDE_API_KEY`

### Timeout errors
```
Error: HTTP request timeout
```
**Fix**: Increase timeout:
```bash
export ORCHESTRATOR_HTTP_TIMEOUT_SECONDS=30
```

---

**Last Updated**: February 23, 2026  
**Version**: Multi-Agent Orchestrator v0.1.0
