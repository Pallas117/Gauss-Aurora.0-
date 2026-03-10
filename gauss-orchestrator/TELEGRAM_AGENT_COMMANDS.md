# GAUSS Orchestrator: Interactive Agent Commands & Autonomous Fixing

You can now **chat with AI agents directly via Telegram** and trigger **autonomous code fixes**!

## **Interactive Commands via Telegram**

Send these commands to the `@adagaussbot` on Telegram while the orchestrator is running:

### **1. `/analyze` - Run Code Analysis**
Triggers immediate code analysis with multi-agent review.

```
You: /analyze
Bot Response:
📊 Code Analysis Complete
Files: 20
Symbols: 72
Issues: 51
🔴 Critical: 0
🟠 Errors: 0
🟡 Warnings: 8
Use /fix to apply autonomous fixes or /help for more options.
```

**What happens behind the scenes:**
1. ✅ Indexes your codebase (20 files, 72 symbols)
2. ✅ Detects all issues (51 total, categorized by severity)
3. ✅ Routes to agent team:
   - 🧠 DeepSeek - Deep reasoning & architecture analysis
   - 🔮 GPT-4 - Code generation & refactoring suggestions
   - 🛡️ Claude - Safety & best practices review
   - 📊 Gemini - Metrics & performance analysis
4. ✅ Sends consensus report with recommendations

### **2. `/fix` - Apply Autonomous Fixes**
Applies validated fixes to your code automatically.

```
You: /fix
Bot Response:
✅ Fix Results
Applied: 3 fixes
Failed: 0
Validated: ✓
💾 Changes have been applied and tested.
```

**What happens:**
1. ✅ Analyzes code for fixable issues
2. ✅ Applies patches (documentation, naming, etc.)
3. ✅ Validates with `cargo test`
4. ✅ Only commits fixes that pass validation
5. ✅ Reports results back to you

**Safe Mode:** Only fixes that can be automatically validated are applied.

### **3. `/status` - Check System Status**
Shows orchestrator health and agent availability.

```
You: /status
Bot Response:
✅ Orchestrator Status
System: Running
Telegram: Connected
🧠 Agents Ready:
• DeepSeek
• GPT-4
• Claude
• Gemini
📁 File Watcher: Active
Available Commands:
/analyze - Run code analysis
/fix - Apply autonomous fixes
/help - Show all commands
```

### **4. `/help` - Show Available Commands**
Displays all commands and how to use them.

```
You: /help
Bot Response:
🤖 GAUSS Orchestrator - Agent Commands
/analyze - Run code analysis
  • Indexes codebase
  • Detects issues
  • Consults 4 AI agents
/fix - Apply autonomous fixes
  • Identifies fixable issues
  • Applies patches
  • Validates with tests
/status - Show system & agent status
/help - Show this message
💬 How to use:
Send commands in this chat and agents will respond with analysis & fixes.
```

---

## **Autonomous Fixing with Validation**

Enable autonomous fixing to let agents automatically patch your code:

```bash
ORCHESTRATOR_TELEGRAM_BOT_TOKEN=your_token \
ORCHESTRATOR_TELEGRAM_CHAT_ID=your_chat_id \
ORCHESTRATOR_ANALYZE_AT_STARTUP=true \
ORCHESTRATOR_ANALYZE_WITH_AGENTS=true \
ORCHESTRATOR_AUTO_FIX=true \
cargo run --release
```

**How it works:**

1. **Analysis Phase**
   - Code is indexed and analyzed
   - Issues are categorized (Critical/Error/Warning/Info)
   - Multi-agent system evaluates each issue

2. **Fixing Phase**
   - Fixable issues identified (documentation, naming, etc.)
   - Agents generate fix code
   - Patches applied to files

3. **Validation Phase**
   - Fixes validated with `cargo test`
   - Code compiled to check syntax
   - Only valid fixes committed

4. **Reporting Phase**
   - Results sent to Telegram
   - Success/failure counts reported
   - Diff shown for review

**Example Telegram Report:**
```
✅ Multi-agent analysis complete, report sent to Telegram
🔧 Applying 3 autonomous fixes...
✅ Fix Results
Applied: 3 fixes
Failed: 0
Validated: ✓
Changes:
  • Added missing documentation to default_state()
  • Fixed naming convention in router()
  • Added test coverage for serve()
```

---

## **Complete Setup Example**

```bash
# Set up environment
export ORCHESTRATOR_TELEGRAM_BOT_TOKEN="your-telegram-bot-token"
export ORCHESTRATOR_TELEGRAM_CHAT_ID="7909911632"
export ORCHESTRATOR_ANALYZE_AT_STARTUP=true
export ORCHESTRATOR_ANALYZE_WITH_AGENTS=true
export ORCHESTRATOR_AUTO_FIX=true

# Add API keys for full agent capabilities (optional)
export OPENAI_API_KEY="sk-..."              # For GPT-4
export ANTHROPIC_API_KEY="sk-ant-..."       # For Claude
export GEMINI_API_KEY="..."                 # For Gemini

# Run the orchestrator
cargo run --release
```

**What you get:**
- 📱 **Telegram Commands** - Chat with agents via `/analyze`, `/fix`, `/status`, `/help`
- 🧠 **Multi-Agent Analysis** - DeepSeek, GPT-4, Claude, Gemini review your code
- 🔧 **Autonomous Fixes** - Automatic patches applied and validated
- 📊 **Real-time Reports** - All findings sent to your Telegram chat
- 👁️ **File Watching** - Continuous monitoring of telemetry files
- 🚀 **Fully Autonomous** - Runs hands-free on your server

---

## **Command Response Flow**

```
┌─────────────────────────────────────────────────────────┐
│ You send command via Telegram (e.g., /analyze)          │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────▼────────────┐
        │ TelegramConnector       │
        │ Receives message        │
        └────────────┬────────────┘
                     │
        ┌────────────▼──────────────────┐
        │ CommandHandler                 │
        │ Parses /analyze command        │
        └────────────┬──────────────────┘
                     │
        ┌────────────▼──────────────────┐
        │ CodeIndexer                    │
        │ Scans 20 files, 72 symbols     │
        └────────────┬──────────────────┘
                     │
        ┌────────────▼──────────────────┐
        │ CodeAnalyzer                   │
        │ Detects 51 issues              │
        └────────────┬──────────────────┘
                     │
        ┌────────────▼──────────────────────┐
        │ MultiAgentOrchestrator             │
        │ Routes to 4 AI agents in parallel  │
        │ • DeepSeek  • GPT-4                │
        │ • Claude    • Gemini               │
        └────────────┬──────────────────────┘
                     │
        ┌────────────▼──────────────────┐
        │ CodeAnalysisOrchestrator       │
        │ Generates consensus report     │
        └────────────┬──────────────────┘
                     │
        ┌────────────▼──────────────────┐
        │ TelegramConnector              │
        │ Sends formatted report         │
        └────────────┬──────────────────┘
                     │
        ┌────────────▼────────────────────────────┐
        │ Your Telegram: Receives agent analysis │
        │ 📊 Statistics + 🧠 Consensus Review     │
        └─────────────────────────────────────────┘
```

---

## **FAQ**

**Q: Can I run /analyze and /fix from my phone?**
A: Yes! Any device with Telegram can send commands. Just message the bot.

**Q: What if a fix fails validation?**
A: Failed fixes are not applied. The bot reports which fixes failed and why.

**Q: How do I add more API keys for full agent power?**
A: Set environment variables before running:
```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export GEMINI_API_KEY="..."
```

**Q: Can I disable specific agents?**
A: Currently all enabled agents are used. You can exclude them by not setting their API keys.

**Q: How often should I run /analyze?**
A: Run it:
- Daily for continuous improvement
- After major code changes
- Before deployments
- Anytime you want multi-agent review

**Q: What about costs?**
A: Each agent call costs a small amount. Budget accordingly:
- DeepSeek (cheapest, local)
- GPT-4 (moderate)
- Claude (moderate)
- Gemini (varies)

---

## **Next Steps**

1. **Start the orchestrator:**
   ```bash
   ORCHESTRATOR_TELEGRAM_BOT_TOKEN=your_token \
   ORCHESTRATOR_TELEGRAM_CHAT_ID=your_chat_id \
   cargo run --release
   ```

2. **Send your first command:**
   ```
   Open Telegram → Find @adagaussbot → Send /analyze
   ```

3. **Review the report:**
   ```
   Bot sends statistics, detected issues, agent analysis
   ```

4. **Apply fixes (optional):**
   ```
   Send /fix to apply autonomous patches
   ```

5. **Monitor your code:**
   ```
   Run /analyze regularly to track improvements
   ```

---

**Your autonomous code intelligence team is ready!** 🚀
