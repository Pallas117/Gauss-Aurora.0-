# Running Agent Analysis from Your Phone

You can trigger code analysis and interact with the GAUSS orchestrator in several ways:

## **Option 1: Telegram Bot Messages** (Easiest for your phone)

Once you've set up Telegram integration, the bot will send you:
- 📊 Analysis reports with findings
- 🧠 Multi-agent consensus reviews
- ✅ Fix recommendations

**Setup:**
```bash
ORCHESTRATOR_TELEGRAM_BOT_TOKEN=your_bot_token \
ORCHESTRATOR_TELEGRAM_CHAT_ID=your_chat_id \
ORCHESTRATOR_ANALYZE_AT_STARTUP=true \
cargo run --release
```

The bot will:
1. Start analysis immediately
2. Send progress updates to Telegram
3. Send final report with agent insights
4. Show recommended fixes

## **Option 2: Create Telemetry File** (From your phone's SSH session)

Trigger file watcher by creating a new CSV:

```bash
# SSH to your server
ssh user@server

# Create telemetry file
echo "Satellite_ID_001,Lat:42.5,Lon:-73.2,Status:ACTIVE" > \
  ~/path/to/orchestrator/new_telemetry/trigger_$(date +%s).csv
```

The orchestrator will:
1. Detect the new file
2. Analyze sensitivity (HIGH/LOW)
3. Route to appropriate agent (local DeepSeek or cloud)
4. Send Telegram report with findings

## **Option 3: HTTP API** (Recommended for phone integration)

Set up the PASS API endpoint:

```bash
ORCHESTRATOR_PASS_API_ENABLED=true \
ORCHESTRATOR_PASS_API_BIND=0.0.0.0:8091 \
cargo run --release
```

Then from your phone, make HTTP requests:

### Trigger Analysis
```bash
curl -X POST http://your-server:8091/api/analyze
```

### Get Status
```bash
curl http://your-server:8091/api/status
```

### Submit Telemetry
```bash
curl -X POST http://your-server:8091/api/telemetry \
  -H "Content-Type: application/json" \
  -d '{
    "satellite_id": "SAT-001",
    "latitude": 42.5,
    "longitude": -73.2,
    "status": "ACTIVE"
  }'
```

## **Complete Setup for Phone Control**

Combine all features for maximum flexibility:

```bash
# Set all options
export ORCHESTRATOR_TELEGRAM_BOT_TOKEN=your_bot_token
export ORCHESTRATOR_TELEGRAM_CHAT_ID=your_chat_id
export ORCHESTRATOR_PASS_API_ENABLED=true
export ORCHESTRATOR_PASS_API_BIND=0.0.0.0:8091
export ORCHESTRATOR_ANALYZE_AT_STARTUP=false    # Don't auto-run
export ORCHESTRATOR_ANALYZE_WITH_AGENTS=true     # Use all 4 agents
export ORCHESTRATOR_AUTO_FIX=true                # Auto-fix High confidence issues

# Run the orchestrator
cargo run --release
```

Now you can:

### From your phone via Telegram:
- Receive agent analysis reports
- Get notifications of detected issues
- See fix recommendations

### From your phone via HTTP API (cURL, REST client, etc):
- Trigger analysis on-demand
- Submit telemetry for sensitivity classification
- Check system status
- Monitor agent availability

## **Quick Reference: Environment Variables**

| Variable | Purpose | Example |
|----------|---------|---------|
| `ORCHESTRATOR_TELEGRAM_BOT_TOKEN` | Telegram bot API token | `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11` |
| `ORCHESTRATOR_TELEGRAM_CHAT_ID` | Target Telegram chat | `987654321` |
| `ORCHESTRATOR_ANALYZE_AT_STARTUP` | Run analysis on boot | `true` or `false` |
| `ORCHESTRATOR_ANALYZE_WITH_AGENTS` | Use multi-agent system | `true` or `false` |
| `ORCHESTRATOR_AUTO_FIX` | Apply fixes autonomously | `true` or `false` |
| `ORCHESTRATOR_PASS_API_ENABLED` | Enable HTTP API | `true` or `false` |
| `ORCHESTRATOR_PASS_API_BIND` | API listen address | `0.0.0.0:8091` |

## **Typical Phone Workflow**

1. **Setup** (on your server):
   ```bash
   # Start orchestrator with all features enabled
   ORCHESTRATOR_TELEGRAM_BOT_TOKEN=xxx \
   ORCHESTRATOR_TELEGRAM_CHAT_ID=yyy \
   ORCHESTRATOR_PASS_API_ENABLED=true \
   ORCHESTRATOR_PASS_API_BIND=0.0.0.0:8091 \
   ORCHESTRATOR_ANALYZE_WITH_AGENTS=true \
   cargo run --release
   ```

2. **Trigger from phone**:
   - Open Telegram → Get welcome message from bot
   - Open REST client → POST to `/api/analyze` endpoint
   - Observe Telegram messages with:
     - 📊 Code statistics (files, symbols, issues)
     - 🧠 Multi-agent analysis (DeepSeek, GPT-4, Claude, Gemini)
     - ✅ Recommended fixes
     - 🔧 Auto-fix results (if enabled)

3. **Iterate**:
   - Review findings
   - Trigger more analyses
   - Monitor agent consensus

## **Agents Available**

When you trigger analysis from your phone, these agents analyze in parallel:

- **DeepSeek** (via local HTTP or API)
  - Reasoning about code architecture
  - Deep analysis of complex issues
  
- **GPT-4** (via OpenAI API)
  - Code generation suggestions
  - Refactoring recommendations
  
- **Claude** (via Anthropic API)
  - Safety & best practices review
  - Security vulnerability checks
  
- **Gemini** (via Google API)
  - Data analysis of metrics
  - Performance insights

**Consensus**: All agents vote on recommendations, confidence scores aggregated.

---

**Next Steps**: 
1. Get Telegram bot token from @BotFather on Telegram
2. Get your Telegram chat ID
3. Export environment variables and start orchestrator
4. Send message to bot or make HTTP request from phone
5. Receive agent analysis reports on Telegram
