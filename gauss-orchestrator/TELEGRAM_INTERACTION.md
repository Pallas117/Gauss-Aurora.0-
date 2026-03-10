# GAUSS Orchestrator: Telegram Integration Guide

## How Analysis Gets Triggered

The orchestrator has **three primary trigger mechanisms**:

### 1. **Startup Trigger** (One-Time at Boot)
```bash
ORCHESTRATOR_ANALYZE_AT_STARTUP=true cargo run --release
```

- Runs autonomous code analysis immediately when orchestrator starts
- Indexes codebase, detects issues, routes to multi-agent system
- Sends full report via Telegram to configured chat
- Then continues to file watching mode

**Use Case**: Deploy and immediately get a code health report

### 2. **File Watcher Trigger** (Continuous - Always Active)
```
Monitors: ORCHESTRATOR_TELEMETRY_DIR (default: ./new_telemetry)
Debounce: 2 seconds (configurable via ORCHESTRATOR_WATCH_DEBOUNCE_MS)
```

- Automatically detects new `.csv` telemetry files in the watched directory
- Routes based on sensitivity classification:
  - **HIGH sensitivity** → Local DeepSeek processing (on-device, private)
  - **LOW/UNKNOWN sensitivity** → Cloud strategic layer
- This is the **primary real-time trigger** for telemetry processing

**Use Case**: Continuous automation of incoming telemetry streams

### 3. **Manual Trigger via Configuration**
```bash
# Environment variables that enable agent-based analysis:
ORCHESTRATOR_ANALYZE_WITH_AGENTS=true
ORCHESTRATOR_AUTO_FIX=true
```

- When enabled with startup trigger, activates multi-agent analysis
- Routes issues through consensus-based agent pipeline
- Can apply autonomous fixes if `ORCHESTRATOR_AUTO_FIX=true`

---

## Telegram Interaction Model

### **Current Implementation: Report Broadcasting**

The orchestrator uses **one-way Telegram communication** (optimized for reliability):

```
┌─────────────────┐
│  Orchestrator   │
│  (Analysis)     │
└────────┬────────┘
         │
         │ send_message()
         ▼
    ┌──────────┐
    │ Telegram │
    │   API    │
    └────┬─────┘
         │
         ▼
    ┌──────────┐
    │   Your   │
    │   Chat   │
    └──────────┘
```

**Messages Include:**
- 📊 Code indexing results (files, symbols, lines)
- ⚠️ Issue detection breakdown (critical, errors, warnings)
- 🧠 Multi-agent analysis consensus (DeepSeek, GPT-4, Claude, Gemini perspectives)
- 🔧 Autonomous fix recommendations
- ✅ Success/failure notifications

### **Telegram Report Methods**

Available in `src/telegram_connector.rs`:

```rust
// Basic notification
pub async fn notify(&self, msg: &str)

// Error notification
pub async fn notify_error(&self, title: &str, error: &str)

// Success notification
pub async fn notify_success(&self, msg: &str)

// Code analysis report (multi-agent consensus)
pub async fn send_code_analysis_report(&self, analyses: &[MultiAgentAnalysis], total_issues: usize)

// Detailed issue information
pub async fn send_issue_details(&self, issue_type: &str, location: &str, details: &str)

// Fix results and validation
pub async fn send_fix_results(&self, fixes_applied: usize, validated: usize)
```

---

## Configuration for Telegram Integration

### **Required Environment Variables**

```bash
# Telegram bot credentials
ORCHESTRATOR_TELEGRAM_BOT_TOKEN="your_bot_token_here"
ORCHESTRATOR_TELEGRAM_CHAT_ID=123456789

# Optional: Enable analysis on startup
ORCHESTRATOR_ANALYZE_AT_STARTUP=true

# Optional: Enable multi-agent consensus analysis
ORCHESTRATOR_ANALYZE_WITH_AGENTS=true

# Optional: Enable autonomous fix application
ORCHESTRATOR_AUTO_FIX=true
```

### **Getting Your Telegram Credentials**

1. **Create a bot** via [@BotFather](https://t.me/botfather) on Telegram
2. **Get your token** from the bot creation response
3. **Get your chat ID**:
   ```bash
   # Send a message to your bot, then:
   curl "https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates"
   # Look for "id" in the chat object
   ```

### **Sample `.env` File**

```bash
# Telegram Configuration
ORCHESTRATOR_TELEGRAM_BOT_TOKEN=1234567890:ABCDEFGhijklmnopqrstuvwxyz_1234567890
ORCHESTRATOR_TELEGRAM_CHAT_ID=987654321

# Analysis Triggers
ORCHESTRATOR_ANALYZE_AT_STARTUP=true
ORCHESTRATOR_ANALYZE_WITH_AGENTS=true
ORCHESTRATOR_AUTO_FIX=false

# Telemetry Processing
ORCHESTRATOR_TELEMETRY_DIR=./new_telemetry
ORCHESTRATOR_WATCH_DEBOUNCE_MS=2000

# AI Model Configuration
ORCHESTRATOR_LOCAL_ENGINE_URL=http://localhost:8080/v1/chat/completions
ORCHESTRATOR_CLOUD_ENABLED=true
```

---

## Message Examples

### **Startup Analysis Report**
```
🔍 GAUSS ORCHESTRATOR: Code Analysis Complete

📊 Statistics:
• Files: 18
• Symbols: 66
• Issues: 48

⚠️  Severity Breakdown:
• 🔴 Critical: 2
• 🟠 Errors: 8
• 🟡 Warnings: 15
• ℹ️ Info: 23

💬 Multi-Agent Analysis:
🧠 DeepSeek: "Architecture follows async/await patterns correctly. Consider optimizing regex performance."
🤖 GPT-4: "Code quality solid. Suggest: add more comprehensive error handling in routing layer."
🛡️ Claude: "Security posture good. No obvious vulnerabilities detected. Recommend: validate all telemetry sources."
🔬 Gemini: "Data flow analysis complete. Sensitivity classification accurate. Processing efficiency: 95%"

Consensus Confidence: 87%
```

### **Telemetry Processing Notification**
```
📊 New Telemetry Detected: satellite_reading_2026-02-23.csv

🔍 Sensitivity Analysis:
Keywords detected: [CLASSIFIED, MILITARY_DESIGNATION]

🧠 Sensitivity: HIGH
Routing to LOCAL DeepSeek (on-device processing)

✅ Processing complete
```

### **Multi-Agent Agreement**
```
💬 Multi-Agent Communication

Your request has been routed to the agent team:

🧠 Agents Available:
• DeepSeek (reasoning & analysis)
• GPT-4 (code generation & synthesis)
• Claude (safety & best practices)
• Gemini (data analysis)

📊 Analysis will include:
• Code structure indexing
• Issue detection & classification
• Multi-agent consensus
• Autonomous fix recommendations

Status: Complete ✅
```

---

## How Agents Communicate Through Orchestrator

### **Agent Collaboration Flow**

```
User/Telegram Request
    ↓
Orchestrator determines task type
    ↓
Routes to appropriate agents:
├─ Reasoning tasks → DeepSeek + GPT-4
├─ Code gen tasks → GPT-4 + Claude + DeepSeek
└─ Safety checks → Claude + GPT-4
    ↓
Each agent analyzes independently
    ↓
Orchestrator computes consensus
    ↓
Report formatted with:
  • Individual agent perspectives
  • Confidence scores
  • Unified recommendation
    ↓
Sent back via Telegram
```

### **Agent Specialization**

| Agent | Strength | Used For |
|-------|----------|----------|
| **DeepSeek** | Complex reasoning, mathematical analysis | Problem decomposition, architecture review |
| **GPT-4** | Code generation, synthesis | Fix suggestions, refactoring proposals |
| **Claude** | Safety, best practices, compliance | Security review, pattern validation |
| **Gemini** | Data analysis, trends, relationships | Code metrics, coverage analysis |

---

## Advanced: Custom Telegram Messages

To send custom messages from your Rust code:

```rust
// In any module with access to TelegramConnector:
let telegram = TelegramConnector::new(&token, chat_id);

// Send formatted analysis
telegram.send_code_analysis_report(&analyses, total_issues).await;

// Send issue details
telegram.send_issue_details("MissingErrorHandling", "src/routing.rs:42", "Route handler missing try/catch").await;

// Send fix results
telegram.send_fix_results(5, 5).await; // 5 fixes applied, all 5 validated
```

---

## Troubleshooting

### **Bot not sending messages**
```bash
# 1. Verify token is valid
curl https://api.telegram.org/botYOUR_TOKEN/getMe

# 2. Check chat ID is correct (must be an integer)
curl "https://api.telegram.org/botYOUR_TOKEN/sendMessage?chat_id=YOUR_CHAT_ID&text=test"

# 3. Verify environment variables are set
echo $ORCHESTRATOR_TELEGRAM_BOT_TOKEN
echo $ORCHESTRATOR_TELEGRAM_CHAT_ID
```

### **Analysis not triggering**
```bash
# Check logs for startup trigger
cargo run --release 2>&1 | grep "analyze"

# If no output, verify environment variable
ORCHESTRATOR_ANALYZE_AT_STARTUP=true cargo run --release

# For file watcher trigger, drop a test CSV file:
mkdir -p new_telemetry
echo "test,data,here" > new_telemetry/test.csv
```

### **Rate limiting**
If bot stops sending messages:
- Telegram limits to ~30 messages/second per bot
- Orchestrator spaces out analysis reports
- Check logs for rate limit errors

---

## Next Steps

1. **Set environment variables** with your Telegram credentials
2. **Start the orchestrator** with analysis enabled:
   ```bash
   ORCHESTRATOR_TELEGRAM_BOT_TOKEN=<your_token> \
   ORCHESTRATOR_TELEGRAM_CHAT_ID=<your_chat_id> \
   ORCHESTRATOR_ANALYZE_AT_STARTUP=true \
   ORCHESTRATOR_ANALYZE_WITH_AGENTS=true \
   cargo run --release
   ```
3. **Monitor your Telegram chat** for analysis reports
4. **Check logs** for detailed processing information:
   ```bash
   RUST_LOG=debug cargo run --release 2>&1 | grep -E "analysis|agent|telegram"
   ```

---

## Architecture Diagram: Full Flow

```
┌──────────────────────────────────────────────────────────────┐
│                    GAUSS ORCHESTRATOR                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐         ┌──────────────────┐              │
│  │ File Watcher│         │ Startup Trigger  │              │
│  │ (Telemetry) │         │ (Code Analysis)  │              │
│  └──────┬──────┘         └────────┬─────────┘              │
│         │                         │                         │
│         └──────────┬──────────────┘                         │
│                    ▼                                        │
│          ┌──────────────────┐                              │
│          │  Sensitivity     │                              │
│          │  Classifier      │                              │
│          └────┬─────────┬───┘                              │
│               │         │                                  │
│        HIGH   │    LOW/UNKNOWN                            │
│               │         │                                  │
│      ┌────────▼──┐  ┌──▼────────┐                         │
│      │   Local   │  │  Cloud    │                         │
│      │ DeepSeek  │  │ Strategic │                         │
│      │ (Private) │  │  Layer    │                         │
│      └────────┬──┘  └──┬────────┘                         │
│               └────┬────┘                                  │
│                    ▼                                       │
│        ┌──────────────────────────┐                       │
│        │  Multi-Agent System      │                       │
│        │ (Consensus Analysis)     │                       │
│        │ - DeepSeek               │                       │
│        │ - GPT-4                  │                       │
│        │ - Claude                 │                       │
│        │ - Gemini                 │                       │
│        └────────┬─────────────────┘                       │
│                 ▼                                         │
│      ┌──────────────────────┐                            │
│      │  Analysis Reporter   │                            │
│      │  (Telegram Format)   │                            │
│      └────────┬─────────────┘                            │
│              ▼                                           │
└─────────────────────────────────────────────────────────┘
              │
              ▼
         ┌─────────┐
         │Telegram │
         │   Bot   │
         └────┬────┘
              │
              ▼
        ┌──────────┐
        │   Your   │
        │   Chat   │
        │  📱📊    │
        └──────────┘
```
