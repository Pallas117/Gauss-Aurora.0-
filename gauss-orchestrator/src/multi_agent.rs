//! Multi-agent orchestration system for collaborative AI inference.
//!
//! This module enables different AI models (DeepSeek, Gemini, GPT-4, Claude) to work together
//! on a single problem by routing tasks based on model strengths and collecting results.
//!
//! **No egress by default**: When `strict_local_inference` is true (default), only the local
//! engine (127.0.0.1, ::1, or Tailscale 100.x.x.x) is used—aligned with MLX-style local-first.

use crate::local_only;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Duration;

/// Represents a single AI model's capability
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum AIModel {
    /// DeepSeek reasoning model (local or cloud-based)
    DeepSeek,
    /// Google's Gemini (multimodal, fast reasoning)
    Gemini,
    /// OpenAI's GPT-4 (general intelligence, coding)
    GPT4,
    /// Anthropic's Claude (instruction-following, analysis)
    Claude,
}

impl std::fmt::Display for AIModel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AIModel::DeepSeek => write!(f, "DeepSeek"),
            AIModel::Gemini => write!(f, "Gemini"),
            AIModel::GPT4 => write!(f, "GPT-4"),
            AIModel::Claude => write!(f, "Claude"),
        }
    }
}

/// Describes the type of task for specialized routing
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TaskType {
    /// Deep reasoning and mathematical analysis
    Reasoning,
    /// Code generation and debugging
    CodeGeneration,
    /// Fast semantic understanding
    Comprehension,
    /// Safety and alignment filtering
    SafetyCheck,
    /// Data analysis and pattern matching
    DataAnalysis,
}

/// Result from a single agent's processing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentResult {
    /// Which model produced this result
    pub model: AIModel,
    /// The response text
    pub response: String,
    /// Confidence (0.0-1.0) in the response quality
    pub confidence: f32,
    /// Processing time in milliseconds
    pub processing_time_ms: u64,
    /// Any errors encountered
    pub error: Option<String>,
}

/// Orchestrates multi-agent processing with consensus/voting
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiAgentResult {
    /// Individual results from each agent
    pub agent_results: Vec<AgentResult>,
    /// Synthesized consensus/summary
    pub consensus: String,
    /// Overall confidence in the result
    pub overall_confidence: f32,
}

/// Configuration for multi-agent processing
#[derive(Clone)]
pub struct MultiAgentConfig {
    pub deepseek_url: String,
    pub deepseek_api_key: Option<String>,
    pub gemini_api_key: Option<String>,
    pub openai_api_key: Option<String>,
    pub claude_api_key: Option<String>,
    pub timeout_seconds: u64,
    /// When true, only local/trusted decision URLs; no cloud LLM egress. Default true.
    pub strict_local_inference: bool,
}

impl MultiAgentConfig {
    /// Load multi-agent config from environment variables (defaults to local engine for offline-only)
    pub fn from_env() -> Self {
        Self {
            deepseek_url: std::env::var("ORCHESTRATOR_LOCAL_ENGINE_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:8089/v1/chat/completions".to_string()),
            deepseek_api_key: std::env::var("ORCHESTRATOR_LOCAL_ENGINE_API_KEY")
                .or_else(|_| std::env::var("DEEPSEEK_API_KEY"))
                .ok(),
            gemini_api_key: std::env::var("GEMINI_API_KEY").ok(),
            openai_api_key: std::env::var("ORCHESTRATOR_OPENAI_API_KEY")
                .or_else(|_| std::env::var("OPENAI_API_KEY"))
                .ok(),
            claude_api_key: std::env::var("CLAUDE_API_KEY")
                .or_else(|_| std::env::var("ANTHROPIC_API_KEY"))
                .ok(),
            timeout_seconds: std::env::var("ORCHESTRATOR_HTTP_TIMEOUT_SECONDS")
                .ok()
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(8),
            strict_local_inference: std::env::var("ORCHESTRATOR_STRICT_LOCAL_INFERENCE")
                .ok()
                .map(|v| {
                    let s = v.trim().to_lowercase();
                    !["0", "false", "off", "no"].contains(&s.as_str())
                })
                .unwrap_or(true),
        }
    }
}

/// Main orchestrator for multi-agent collaboration
#[derive(Clone)]
pub struct MultiAgentOrchestrator {
    client: Client,
    config: MultiAgentConfig,
}

impl MultiAgentOrchestrator {
    pub fn new(config: MultiAgentConfig) -> Self {
        // Avoid platform proxy discovery in constrained/sandboxed environments.
        let client = Client::builder()
            .no_proxy()
            .build()
            .unwrap_or_else(|_| Client::new());
        Self {
            client,
            config,
        }
    }

    /// Route task to specific models based on strengths
    pub async fn route_by_task(
        &self,
        task: TaskType,
        input: &str,
    ) -> Result<MultiAgentResult, String> {
        // Select models based on task type
        let models = self.select_models_for_task(task);

        tracing::info!(
            task = ?task,
            models_count = models.len(),
            "routing task to multiple agents"
        );

        // Execute all agents in parallel
        let config = self.config.clone();
        let client = self.client.clone();

        let handles: Vec<_> = models
            .iter()
            .map(|model| {
                let model = model.clone();
                let client = client.clone();
                let config = config.clone();
                let input = input.to_string();

                tokio::spawn(async move { self_call_agent(&client, model, &input, &config).await })
            })
            .collect();

        // Collect results
        let mut results = Vec::new();
        for handle in handles {
            match handle.await {
                Ok(Ok(result)) => {
                    tracing::info!(
                        model = %result.model,
                        confidence = %result.confidence,
                        processing_time_ms = result.processing_time_ms,
                        "agent result received"
                    );
                    results.push(result);
                }
                Ok(Err(e)) => {
                    tracing::warn!(error = %e, "agent processing failed");
                }
                Err(e) => {
                    tracing::warn!(error = %e, "agent task cancelled or panicked");
                }
            }
        }

        if results.is_empty() {
            return Err("No agents produced valid results".to_string());
        }

        // Generate consensus from results
        let consensus = self.synthesize_consensus(&results, input).await?;

        let overall_confidence =
            results.iter().map(|r| r.confidence).sum::<f32>() / results.len() as f32;

        Ok(MultiAgentResult {
            agent_results: results,
            consensus,
            overall_confidence,
        })
    }

    /// Select best models for a given task type (only returns models that are configured, so offline-only uses just DeepSeek).
    /// When strict_local_inference is true, only DeepSeek on a local/trusted URL is allowed—no cloud egress.
    fn select_models_for_task(&self, task: TaskType) -> Vec<AIModel> {
        let has_deepseek = !self.config.deepseek_url.is_empty()
            && (!self.config.strict_local_inference || local_only::is_local_or_trusted(&self.config.deepseek_url));
        let has_gemini = !self.config.strict_local_inference && self.config.gemini_api_key.is_some();
        let has_openai = !self.config.strict_local_inference && self.config.openai_api_key.is_some();
        let has_claude = !self.config.strict_local_inference && self.config.claude_api_key.is_some();

        let candidates: Vec<AIModel> = match task {
            TaskType::Reasoning => {
                if has_deepseek {
                    vec![AIModel::DeepSeek]
                } else {
                    vec![]
                }
            }
            TaskType::CodeGeneration => vec![AIModel::GPT4, AIModel::Claude, AIModel::DeepSeek],
            TaskType::Comprehension => vec![AIModel::Gemini, AIModel::Claude],
            TaskType::SafetyCheck => vec![AIModel::Claude, AIModel::GPT4],
            TaskType::DataAnalysis => vec![AIModel::DeepSeek, AIModel::GPT4, AIModel::Gemini],
        };

        // When only local engine is configured (or strict local), use DeepSeek for all task types
        if has_deepseek && !has_gemini && !has_openai && !has_claude {
            return vec![AIModel::DeepSeek];
        }

        candidates
            .into_iter()
            .filter(|m| match m {
                AIModel::DeepSeek => has_deepseek,
                AIModel::Gemini => has_gemini,
                AIModel::GPT4 => has_openai,
                AIModel::Claude => has_claude,
            })
            .collect()
    }

    /// Synthesize consensus from multiple agent results (uses DeepSeek when no cloud synthesis model is configured)
    async fn synthesize_consensus(
        &self,
        results: &[AgentResult],
        original_input: &str,
    ) -> Result<String, String> {
        if results.len() == 1 {
            return Ok(results[0].response.clone());
        }

        // Build prompt for consensus synthesis
        let agent_responses = results
            .iter()
            .map(|r| format!("{}: {}", r.model, r.response))
            .collect::<Vec<_>>()
            .join("\n\n---\n\n");

        let synthesis_prompt = format!(
            "Original task:\n{}\n\nResponses from different AI models:\n{}\n\nSynthesize a consensus response that combines the best insights from all models.",
            original_input, agent_responses
        );

        // Prefer cloud synthesis only when not strict-local; otherwise use local DeepSeek (no egress)
        let use_cloud = !self.config.strict_local_inference;
        if use_cloud && self.config.openai_api_key.is_some() {
            self.call_gpt4(&synthesis_prompt).await
        } else if use_cloud && self.config.claude_api_key.is_some() {
            self.call_claude(&synthesis_prompt).await
        } else if !self.config.deepseek_url.is_empty()
            && (!self.config.strict_local_inference || local_only::is_local_or_trusted(&self.config.deepseek_url))
        {
            let result = self.call_deepseek(&synthesis_prompt).await?;
            Ok(result.response)
        } else {
            Ok("Unable to synthesize consensus: no synthesis model configured".to_string())
        }
    }

    /// Call DeepSeek API (or local OpenAI-compatible server; API key optional for local MLX)
    async fn call_deepseek(&self, prompt: &str) -> Result<AgentResult, String> {
        let payload = json!({
            "model": "deepseek-reasoner",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.7,
            "max_tokens": 2000
        });

        let start = std::time::Instant::now();
        let mut request = self
            .client
            .post(&self.config.deepseek_url)
            .json(&payload)
            .timeout(Duration::from_secs(self.config.timeout_seconds));
        if let Some(key) = &self.config.deepseek_api_key {
            request = request.bearer_auth(key);
        }
        let res = request
            .send()
            .await
            .map_err(|e| format!("DeepSeek request failed: {}", e))?;

        let body: serde_json::Value = res
            .json()
            .await
            .map_err(|e| format!("Failed to parse DeepSeek response: {}", e))?;
        let response = body["choices"][0]["message"]["content"]
            .as_str()
            .ok_or("Invalid DeepSeek response format")?
            .to_string();

        Ok(AgentResult {
            model: AIModel::DeepSeek,
            response,
            confidence: 0.85,
            processing_time_ms: start.elapsed().as_millis() as u64,
            error: None,
        })
    }

    /// Call Gemini API
    async fn call_gemini(&self, prompt: &str) -> Result<AgentResult, String> {
        let api_key = self
            .config
            .gemini_api_key
            .as_ref()
            .ok_or("Gemini API key not configured")?;

        let payload = json!({
            "contents": [{
                "parts": [{"text": prompt}]
            }],
            "generationConfig": {
                "temperature": 0.7,
                "maxOutputTokens": 2000
            }
        });

        let start = std::time::Instant::now();
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key={}",
            api_key
        );

        let res = self
            .client
            .post(&url)
            .json(&payload)
            .timeout(Duration::from_secs(self.config.timeout_seconds))
            .send()
            .await
            .map_err(|e| format!("Gemini request failed: {}", e))?;

        let body: serde_json::Value = res
            .json()
            .await
            .map_err(|e| format!("Failed to parse Gemini response: {}", e))?;
        let response = body["candidates"][0]["content"]["parts"][0]["text"]
            .as_str()
            .ok_or("Invalid Gemini response format")?
            .to_string();

        Ok(AgentResult {
            model: AIModel::Gemini,
            response,
            confidence: 0.80,
            processing_time_ms: start.elapsed().as_millis() as u64,
            error: None,
        })
    }

    /// Call GPT-4 API
    async fn call_gpt4(&self, prompt: &str) -> Result<String, String> {
        let api_key = self
            .config
            .openai_api_key
            .as_ref()
            .ok_or("OpenAI API key not configured")?;

        let payload = json!({
            "model": "gpt-4",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.7,
            "max_tokens": 2000
        });

        let res = self
            .client
            .post("https://api.openai.com/v1/chat/completions")
            .bearer_auth(api_key)
            .json(&payload)
            .timeout(Duration::from_secs(self.config.timeout_seconds))
            .send()
            .await
            .map_err(|e| format!("GPT-4 request failed: {}", e))?;

        let body: serde_json::Value = res
            .json()
            .await
            .map_err(|e| format!("Failed to parse GPT-4 response: {}", e))?;
        let response = body["choices"][0]["message"]["content"]
            .as_str()
            .ok_or("Invalid GPT-4 response format")?
            .to_string();

        Ok(response)
    }

    /// Call Claude API
    async fn call_claude(&self, prompt: &str) -> Result<String, String> {
        let api_key = self
            .config
            .claude_api_key
            .as_ref()
            .ok_or("Claude API key not configured")?;

        let payload = json!({
            "model": "claude-3-opus-20240229",
            "max_tokens": 2000,
            "messages": [{
                "role": "user",
                "content": prompt
            }]
        });

        let res = self
            .client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&payload)
            .timeout(Duration::from_secs(self.config.timeout_seconds))
            .send()
            .await
            .map_err(|e| format!("Claude request failed: {}", e))?;

        let body: serde_json::Value = res
            .json()
            .await
            .map_err(|e| format!("Failed to parse Claude response: {}", e))?;
        let response = body["content"][0]["text"]
            .as_str()
            .ok_or("Invalid Claude response format")?
            .to_string();

        Ok(response)
    }
}

/// Helper function to call an agent and return structured result
async fn self_call_agent(
    _client: &Client,
    model: AIModel,
    prompt: &str,
    config: &MultiAgentConfig,
) -> Result<AgentResult, String> {
    match model {
        AIModel::DeepSeek => {
            let orchestrator = MultiAgentOrchestrator::new(MultiAgentConfig {
                deepseek_url: config.deepseek_url.clone(),
                deepseek_api_key: config.deepseek_api_key.clone(),
                gemini_api_key: config.gemini_api_key.clone(),
                openai_api_key: config.openai_api_key.clone(),
                claude_api_key: config.claude_api_key.clone(),
                timeout_seconds: config.timeout_seconds,
                strict_local_inference: config.strict_local_inference,
            });
            orchestrator.call_deepseek(prompt).await
        }
        AIModel::Gemini => {
            let orchestrator = MultiAgentOrchestrator::new(MultiAgentConfig {
                deepseek_url: config.deepseek_url.clone(),
                deepseek_api_key: config.deepseek_api_key.clone(),
                gemini_api_key: config.gemini_api_key.clone(),
                openai_api_key: config.openai_api_key.clone(),
                claude_api_key: config.claude_api_key.clone(),
                timeout_seconds: config.timeout_seconds,
                strict_local_inference: config.strict_local_inference,
            });
            orchestrator.call_gemini(prompt).await
        }
        AIModel::GPT4 => {
            // For GPT-4, return structured result manually
            let api_key = config
                .openai_api_key
                .as_ref()
                .ok_or_else(|| "OpenAI API key not configured".to_string())?;

            let payload = json!({
                "model": "gpt-4",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.7,
                "max_tokens": 2000
            });

            let start = std::time::Instant::now();
            let res = _client
                .post("https://api.openai.com/v1/chat/completions")
                .bearer_auth(api_key)
                .json(&payload)
                .timeout(Duration::from_secs(config.timeout_seconds))
                .send()
                .await
                .map_err(|e| format!("GPT-4 request failed: {}", e))?;

            let body: serde_json::Value = res
                .json()
                .await
                .map_err(|e| format!("Failed to parse GPT-4 response: {}", e))?;
            let response = body["choices"][0]["message"]["content"]
                .as_str()
                .ok_or_else(|| "Invalid GPT-4 response format".to_string())?
                .to_string();

            Ok(AgentResult {
                model: AIModel::GPT4,
                response,
                confidence: 0.88,
                processing_time_ms: start.elapsed().as_millis() as u64,
                error: None,
            })
        }
        AIModel::Claude => {
            // For Claude, return structured result manually
            let api_key = config
                .claude_api_key
                .as_ref()
                .ok_or_else(|| "Claude API key not configured".to_string())?;

            let payload = json!({
                "model": "claude-3-opus-20240229",
                "max_tokens": 2000,
                "messages": [{
                    "role": "user",
                    "content": prompt
                }]
            });

            let start = std::time::Instant::now();
            let res = _client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&payload)
                .timeout(Duration::from_secs(config.timeout_seconds))
                .send()
                .await
                .map_err(|e| format!("Claude request failed: {}", e))?;

            let body: serde_json::Value = res
                .json()
                .await
                .map_err(|e| format!("Failed to parse Claude response: {}", e))?;
            let response = body["content"][0]["text"]
                .as_str()
                .ok_or_else(|| "Invalid Claude response format".to_string())?
                .to_string();

            Ok(AgentResult {
                model: AIModel::Claude,
                response,
                confidence: 0.87,
                processing_time_ms: start.elapsed().as_millis() as u64,
                error: None,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_task_type_routing_reasoning() {
        let config = MultiAgentConfig::from_env();
        let orchestrator = MultiAgentOrchestrator::new(config);
        let models = orchestrator.select_models_for_task(TaskType::Reasoning);
        assert!(models.contains(&AIModel::DeepSeek) || models.is_empty());
    }

    #[test]
    fn test_task_type_routing_code() {
        let config = MultiAgentConfig::from_env();
        let orchestrator = MultiAgentOrchestrator::new(config);
        let models = orchestrator.select_models_for_task(TaskType::CodeGeneration);
        assert!(
            models.contains(&AIModel::DeepSeek)
                || models.contains(&AIModel::GPT4)
                || models.contains(&AIModel::Claude)
                || models.is_empty()
        );
    }

    #[test]
    fn test_task_type_routing_safety() {
        let config = MultiAgentConfig::from_env();
        let orchestrator = MultiAgentOrchestrator::new(config);
        let models = orchestrator.select_models_for_task(TaskType::SafetyCheck);
        assert!(
            models.contains(&AIModel::Claude)
                || models.contains(&AIModel::GPT4)
                || models.contains(&AIModel::DeepSeek)
                || models.is_empty()
        );
    }

    #[test]
    fn test_agent_model_display() {
        assert_eq!(AIModel::DeepSeek.to_string(), "DeepSeek");
        assert_eq!(AIModel::Gemini.to_string(), "Gemini");
        assert_eq!(AIModel::GPT4.to_string(), "GPT-4");
        assert_eq!(AIModel::Claude.to_string(), "Claude");
    }

    #[test]
    fn test_multi_agent_config_from_env() {
        let config = MultiAgentConfig::from_env();
        // Should not panic, uses defaults or env vars
        assert!(!config.deepseek_url.is_empty());
        assert_eq!(config.timeout_seconds, 8); // default
    }
}
