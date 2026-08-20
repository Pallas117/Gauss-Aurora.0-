# AI-Powered Automation on Kali Linux - Complete Setup Guide

## 🤖 Open Source AI Setup

Install local LLMs on your Kali Linux Dell XPS to run AI without internet dependency.

---

## Part 1: Install Ollama (Local LLM Runtime)

### What is Ollama?

**Ollama** = Simple way to run open source LLMs locally
- No cloud needed
- Private (stays on your machine)
- Free and open source
- Integrates easily with APIs

### Installation

```bash
# Download and install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Verify installation
ollama --version
# Should show: ollama version X.X.X
```

### Start Ollama Service

```bash
# Start Ollama server (runs in background)
ollama serve

# OR as systemd service (recommended)
sudo systemctl enable ollama
sudo systemctl start ollama

# Verify it's running
curl http://localhost:11434/api/tags
# Should return JSON with available models
```

---

## Part 2: Install Open Source Models

### Available Options

| Model | Size | Speed | Quality | Best For |
|-------|------|-------|---------|----------|
| **Llama 2** | 7B (3.5GB) | Fast | Good | General |
| **Mistral** | 7B (3.5GB) | Very Fast | Excellent | Fast responses |
| **Neural Chat** | 7B (4GB) | Fast | Good | Chat |
| **Llama 2 13B** | 13B (7.5GB) | Slower | Excellent | Complex tasks |
| **Orca Mini** | 7B (3.5GB) | Fast | Good | Structured output |

### Install Your First Model

```bash
# Install Mistral (fast and good quality)
ollama pull mistral

# OR Llama 2 (most popular)
ollama pull llama2

# OR others
ollama pull neural-chat
ollama pull orca-mini

# List installed models
ollama list
```

### Test Your Model

```bash
# Interactive chat
ollama run mistral

# You'll see prompt:
# >>> 

# Type a question:
# >>> What is Kali Linux?
# [Model responds]

# Exit with Ctrl+D or /quit
```

---

## Part 3: Python Interface for Automation

### Install Python Libraries

```bash
# Install required packages
sudo apt-get install -y python3-pip python3-venv

# Create virtual environment
python3 -m venv ~/ai-automation
source ~/ai-automation/bin/activate

# Install dependencies
pip install ollama requests
pip install python-telegram-bot  # For phone notifications
pip install tailscale-python     # Optional: for Tailscale integration
```

### Create Python Script for Local LLM

Create `~/ai-automation/llm_interface.py`:

```python
#!/usr/bin/env python3
"""
Local LLM Interface - Interact with Ollama models
"""

import ollama
import json
from datetime import datetime

class LocalLLM:
    def __init__(self, model='mistral'):
        self.model = model
        self.client = ollama.Client(host='http://localhost:11434')
    
    def chat(self, prompt, system_prompt=None):
        """Send prompt to local LLM"""
        try:
            messages = []
            
            if system_prompt:
                messages.append({
                    'role': 'system',
                    'content': system_prompt
                })
            
            messages.append({
                'role': 'user',
                'content': prompt
            })
            
            response = self.client.chat(
                model=self.model,
                messages=messages,
                stream=False
            )
            
            return response['message']['content']
        except Exception as e:
            print(f"Error: {e}")
            return None
    
    def stream_chat(self, prompt):
        """Stream response (real-time)"""
        try:
            response = self.client.generate(
                model=self.model,
                prompt=prompt,
                stream=True
            )
            
            for chunk in response:
                print(chunk['response'], end='', flush=True)
            print()
        except Exception as e:
            print(f"Error: {e}")

# Example usage
if __name__ == "__main__":
    llm = LocalLLM(model='mistral')
    
    # Simple query
    response = llm.chat("What is network automation?")
    print(f"Response: {response}")
    
    # System prompt example
    system = "You are a cybersecurity expert. Answer in 2-3 sentences."
    response = llm.chat("Explain intrusion detection systems", system)
    print(f"Security Expert: {response}")
```

### Test the Script

```bash
cd ~/ai-automation

# Run the script
python3 llm_interface.py

# Should show responses from your local LLM
```

---

## Part 4: Phone Notifications Setup

### Option A: Ntfy.sh (Easiest)

```bash
# No installation needed - uses web service
# Notifications via phone app

# Install ntfy app on your phone:
# Android: Google Play Store → search "ntfy"
# iOS: App Store → search "ntfy"

# Send test notification
curl -d "Hello from Kali!" \
  ntfy.sh/your_custom_topic_name

# You'll get notification on phone instantly!
```

### Option B: Gotify (Self-hosted)

```bash
# More private - runs on your server

# Install Gotify
mkdir -p ~/gotify
cd ~/gotify

# Download latest release
wget https://github.com/gotify/server/releases/download/v2.2.3/gotify-linux-amd64.zip
unzip gotify-linux-amd64.zip

# Run it
./gotify -p 3000

# Access at: http://localhost:3000
# Default credentials: admin / admin
```

### Option C: Telegram Bot (Most Powerful)

```bash
# 1. Create Telegram bot
# - Open Telegram
# - Search: @BotFather
# - Send: /newbot
# - Follow prompts
# - Note the API token

# 2. Install Python library
pip install python-telegram-bot

# 3. Get your Telegram ID
# - Send /start to @userinfobot
# - Note your user ID

# 4. Create notification script
```

Create `~/ai-automation/notify.py`:

```python
#!/usr/bin/env python3
"""
Send notifications to Telegram
"""

import requests
from telegram import Bot
import asyncio

class NotificationManager:
    def __init__(self, method='ntfy', telegram_token=None, telegram_chat_id=None):
        self.method = method
        self.telegram_token = telegram_token
        self.telegram_chat_id = telegram_chat_id
    
    def ntfy(self, title, message, topic='kali-automation'):
        """Send via ntfy.sh"""
        try:
            url = f"ntfy.sh/{topic}"
            data = f"{title}: {message}"
            response = requests.post(url, data=data)
            return response.status_code == 200
        except Exception as e:
            print(f"Ntfy error: {e}")
            return False
    
    def telegram(self, message):
        """Send via Telegram bot"""
        try:
            url = f"https://api.telegram.org/bot{self.telegram_token}/sendMessage"
            data = {
                'chat_id': self.telegram_chat_id,
                'text': message
            }
            response = requests.post(url, json=data)
            return response.status_code == 200
        except Exception as e:
            print(f"Telegram error: {e}")
            return False
    
    def send(self, title, message):
        """Send notification via configured method"""
        if self.method == 'ntfy':
            return self.ntfy(title, message)
        elif self.method == 'telegram':
            return self.telegram(f"*{title}*\n{message}")
        return False

# Example
if __name__ == "__main__":
    # Using ntfy (simple)
    notifier = NotificationManager(method='ntfy')
    notifier.send("Kali Alert", "AI automation started!")
```

---

## Part 5: Tailscale Mesh VPN Integration

### Install Tailscale

```bash
# Install Tailscale
curl -fsSL https://tailscale.com/install.sh | sh

# Start service
sudo systemctl enable tailscale
sudo systemctl start tailscale

# Login
sudo tailscale up

# Get your IP
tailscale ip -4
# Save this - you'll use it to access from anywhere

# Share with other devices
tailscale status
```

### Access Your Kali from Phone

```bash
# 1. Install Tailscale on phone (iOS/Android app)
# 2. Login with same account
# 3. Your Kali appears in list
# 4. Connect to it from phone

# Access via Tailscale IP
# From phone/laptop: http://your-tailscale-ip:11434
```

### Secure Remote Access

```bash
# Enable shields up for security
sudo tailscale set --shields-up

# Allow specific apps through firewall
sudo ufw allow from tailscale0
sudo ufw allow 11434/tcp

# Verify connection from another Tailscale device
curl http://your-kali-tailscale-ip:11434/api/tags
```

---

## Part 6: Complete Automation Script

Create `~/ai-automation/automation.py`:

```python
#!/usr/bin/env python3
"""
Complete AI Automation System
- Uses local LLM (Ollama)
- Sends notifications
- Integrates with Tailscale
- Runs tasks in background
"""

import ollama
import requests
import json
import time
import subprocess
from datetime import datetime
from pathlib import Path

class AIAutomationEngine:
    def __init__(self):
        self.llm_model = 'mistral'
        self.ollama_host = 'http://localhost:11434'
        self.notification_method = 'ntfy'
        self.notification_topic = 'kali-automation'
        
        self.log_file = Path.home() / 'ai-automation' / 'automation.log'
        self.log_file.parent.mkdir(exist_ok=True)
    
    def log(self, message, level='INFO'):
        """Log messages"""
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        log_entry = f"[{timestamp}] [{level}] {message}"
        print(log_entry)
        
        with open(self.log_file, 'a') as f:
            f.write(log_entry + '\n')
    
    def ask_ai(self, prompt, system_prompt=None):
        """Query local LLM"""
        try:
            self.log(f"Querying AI: {prompt[:50]}...")
            
            client = ollama.Client(host=self.ollama_host)
            
            messages = []
            if system_prompt:
                messages.append({'role': 'system', 'content': system_prompt})
            
            messages.append({'role': 'user', 'content': prompt})
            
            response = client.chat(
                model=self.llm_model,
                messages=messages,
                stream=False
            )
            
            return response['message']['content']
        except Exception as e:
            self.log(f"AI Query Error: {e}", 'ERROR')
            return None
    
    def notify(self, title, message):
        """Send notification"""
        try:
            if self.notification_method == 'ntfy':
                url = f"ntfy.sh/{self.notification_topic}"
                data = f"{title}: {message}"
                requests.post(url, data=data, timeout=5)
            
            self.log(f"Notification sent: {title}")
            return True
        except Exception as e:
            self.log(f"Notification Error: {e}", 'ERROR')
            return False
    
    def run_command(self, command):
        """Execute system command"""
        try:
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=30
            )
            return result.stdout, result.returncode
        except Exception as e:
            self.log(f"Command Error: {e}", 'ERROR')
            return None, 1
    
    def get_system_status(self):
        """Get current system status"""
        try:
            # Get system info
            cpu, _ = self.run_command('top -bn1 | head -n 3 | tail -n 1')
            memory, _ = self.run_command('free -h | grep Mem')
            disk, _ = self.run_command('df -h / | tail -1')
            
            return f"""
System Status:
CPU: {cpu.strip() if cpu else 'N/A'}
Memory: {memory.strip() if memory else 'N/A'}
Disk: {disk.strip() if disk else 'N/A'}
            """
        except Exception as e:
            self.log(f"Status Error: {e}", 'ERROR')
            return "Status unavailable"
    
    def ai_system_analysis(self):
        """Have AI analyze system status"""
        status = self.get_system_status()
        
        prompt = f"""Analyze this system status and give brief recommendations:

{status}

Keep response to 2-3 sentences. Focus on any issues."""
        
        analysis = self.ask_ai(prompt)
        return analysis
    
    def run_scheduled_task(self, task_name, prompt):
        """Run a specific task"""
        self.log(f"Running task: {task_name}")
        
        response = self.ask_ai(prompt)
        self.notify(task_name, response[:100] if response else "Task failed")
        
        return response
    
    def start_daemon(self, interval=300):
        """Run automation daemon"""
        self.log("Starting automation daemon", 'INFO')
        self.notify("Automation", "Daemon started")
        
        try:
            while True:
                # Run tasks every interval (300s = 5 minutes)
                self.log("Running automated checks...", 'INFO')
                
                # Analyze system
                analysis = self.ai_system_analysis()
                if analysis:
                    self.notify("System Analysis", analysis[:200])
                
                # Sleep until next check
                time.sleep(interval)
        except KeyboardInterrupt:
            self.log("Daemon stopped by user", 'WARNING')
            self.notify("Automation", "Daemon stopped")
        except Exception as e:
            self.log(f"Daemon Error: {e}", 'ERROR')
            self.notify("Daemon Error", str(e)[:100])

# Main execution
if __name__ == "__main__":
    engine = AIAutomationEngine()
    
    # Test mode: run once
    print("🤖 AI Automation Engine Started")
    
    # Test AI
    response = engine.ask_ai("What is Kali Linux used for? (2 sentences)")
    print(f"AI Response: {response}")
    
    # Test notification
    engine.notify("Test", "Automation working!")
    
    # To run daemon (continuous):
    # Uncomment below:
    # engine.start_daemon(interval=300)  # Every 5 minutes
```

---

## Part 7: Setup Systemd Service

Create `/etc/systemd/system/ai-automation.service`:

```ini
[Unit]
Description=AI Automation Engine
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=simple
User=kali
WorkingDirectory=/home/kali/ai-automation
ExecStart=/home/kali/ai-automation/bin/python3 /home/kali/ai-automation/automation.py

# Restart on failure
Restart=on-failure
RestartSec=10

# Logging
StandardOutput=journal
StandardError=journal

# Resource limits
MemoryLimit=500M
CPUQuota=50%

[Install]
WantedBy=multi-user.target
```

### Enable Service

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable service
sudo systemctl enable ai-automation

# Start service
sudo systemctl start ai-automation

# Check status
sudo systemctl status ai-automation

# View logs
sudo journalctl -u ai-automation -f
```

---

## Part 8: Test Everything

```bash
# Test Ollama
curl http://localhost:11434/api/tags

# Test notification
curl -d "Test message from Kali" ntfy.sh/kali-automation

# Test automation script
python3 ~/ai-automation/automation.py

# Test Tailscale access
tailscale ip -4
# Access from phone/laptop:
# http://<your-tailscale-ip>:11434/api/tags

# Test systemd service
sudo systemctl start ai-automation
sudo journalctl -u ai-automation -n 20
```

---

## 📊 Complete Architecture

```
┌─────────────────────────────────────────────┐
│        Kali Linux (Dell XPS)                │
│                                             │
│  ┌──────────────────────────────────────┐  │
│  │  AI Automation Engine (Python)       │  │
│  │  - Handles tasks                     │  │
│  │  - Manages notifications             │  │
│  │  - Runs in background                │  │
│  └──────────────────────────────────────┘  │
│           ↓                  ↓               │
│  ┌──────────────────┐  ┌──────────────┐    │
│  │  Ollama (Local   │  │ Tailscale    │    │
│  │  LLM - Mistral)  │  │ VPN          │    │
│  └──────────────────┘  └──────────────┘    │
└─────────────────────────────────────────────┘
           ↓                  ↓
    ┌─────────────┐      ┌──────────────┐
    │ Ollama API  │      │ Tailscale IP │
    │ localhost   │      │ Mesh VPN     │
    │ :11434      │      │              │
    └─────────────┘      └──────────────┘
           ↓                  ↓
    ┌──────────────────────────────────┐
    │   Phone / Remote Device          │
    │   - View notifications            │
    │   - Query AI                      │
    │   - Control automation            │
    └──────────────────────────────────┘
```

---

## Summary

You now have:
- ✅ Ollama (local LLM runtime)
- ✅ Multiple open source models (Mistral, Llama2, etc)
- ✅ Python interface for automation
- ✅ Phone notification system
- ✅ Tailscale mesh VPN access
- ✅ Systemd daemon for background running
- ✅ Complete logging and monitoring

**Next: Integrate with Claude API for enhanced intelligence!** 🚀
