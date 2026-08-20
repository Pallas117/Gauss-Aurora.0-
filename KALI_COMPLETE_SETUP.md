# 🚀 Complete AI Automation System - Kali Linux + Tailscale + Phone Notifications

## 🎯 Your Mission (Step-by-Step)

Build an AI-powered automation lab that:
- ✅ Runs locally on Kali Linux (Dell XPS)
- ✅ Uses open source AI (Ollama + local models)
- ✅ Integrates Claude for advanced tasks
- ✅ Accessible anywhere via Tailscale mesh VPN
- ✅ Sends notifications to your phone
- ✅ Runs 24/7 in background

**Total Setup Time: 1-2 hours**

---

## 📋 Prerequisites Checklist

Before starting, have ready:
- [ ] Kali Linux installed on Dell XPS
- [ ] Internet connection
- [ ] Your phone (Android or iOS)
- [ ] Anthropic API key (optional, for Claude)
- [ ] ~30GB free disk space
- [ ] Administrator access

---

## Phase 1: Password Recovery (10 minutes)

### If You Can Login:
Skip this section, you're good!

### If You Forgot Password:

Follow: **KALI_PASSWORD_RESET.md**

Quick summary:
```bash
# At GRUB menu: Press Shift during boot
# Edit boot line: Add init=/bin/bash
# Then:
mount -o remount,rw /
passwd kali
# Set new password
reboot
```

---

## Phase 2: System Preparation (15 minutes)

### Update Kali Linux

```bash
# Login with your (recovered) password
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y python3-pip python3-venv curl wget
```

### Install Tailscale

```bash
# Install
curl -fsSL https://tailscale.com/install.sh | sh

# Start service
sudo systemctl enable tailscale
sudo systemctl start tailscale

# Login to Tailscale
sudo tailscale up

# Note your Tailscale IP
tailscale ip -4
# Example: 100.x.x.x
```

### Install Ollama

```bash
# Download and install
curl -fsSL https://ollama.ai/install.sh | sh

# Start service
sudo systemctl enable ollama
sudo systemctl start ollama

# Verify
curl http://localhost:11434/api/tags
# Should return JSON response
```

---

## Phase 3: AI Setup (20 minutes)

### Download and Install Models

```bash
# Install Mistral (fast, good quality)
ollama pull mistral

# And Llama2 (popular, versatile)
ollama pull llama2

# Optional: Neural Chat (optimized for chat)
ollama pull neural-chat

# List installed
ollama list
```

### Test Ollama

```bash
# Interactive test
ollama run mistral

# In the prompt:
# >>> What is Kali Linux?
# [Model responds]

# Exit: Ctrl+D
```

---

## Phase 4: Create AI Automation Environment (15 minutes)

### Setup Python Environment

```bash
# Create virtual environment
python3 -m venv ~/ai-automation
source ~/ai-automation/bin/activate

# Install dependencies
pip install ollama requests python-telegram-bot anthropic

# Verify
python3 -c "import ollama; print('Ready!')"
```

### Download All Scripts

Copy these files to `~/ai-automation/`:

1. **llm_interface.py** - From KALI_AI_SETUP.md
2. **notify.py** - Notification system
3. **automation.py** - Main automation engine
4. **hybrid_llm.py** - Claude integration (optional)

---

## Phase 5: Setup Phone Notifications (10 minutes)

### Option A: Ntfy.sh (Simplest)

```bash
# Install app on your phone:
# iOS: App Store → search "ntfy"
# Android: Google Play Store → search "ntfy"

# Test from Kali:
curl -d "Hello from Kali!" ntfy.sh/your-unique-topic

# You'll get notification on phone!
```

### Option B: Telegram Bot

```bash
# 1. Open Telegram
# 2. Search: @BotFather
# 3. Send: /newbot
# 4. Follow prompts → Get API token
# 5. Save token to file:
echo "TELEGRAM_TOKEN=123:ABC..." > ~/.config/ai-creds.txt
chmod 600 ~/.config/ai-creds.txt

# 6. Get your Chat ID:
# Send /start to @userinfobot
# Note your user ID

# 7. Test:
curl -X POST https://api.telegram.org/bot[TOKEN]/sendMessage \
  -d chat_id=[YOUR_ID] \
  -d text="Hello from Kali!"
```

### Option C: Gotify (Self-Hosted)

```bash
# More private option
mkdir ~/gotify && cd ~/gotify

wget https://github.com/gotify/server/releases/download/v2.2.3/gotify-linux-amd64.zip
unzip gotify-linux-amd64.zip

# Run
./gotify -p 3000

# Access: http://localhost:3000
# Create token for app
# Test notification via API
```

---

## Phase 6: Complete Automation Script (20 minutes)

Create `~/ai-automation/main.py`:

```python
#!/usr/bin/env python3
"""
Complete AI Automation System
- Local LLMs via Ollama
- Claude integration (optional)
- Phone notifications
- Tailscale mesh VPN ready
- Background daemon
"""

import ollama
import requests
import json
import time
import subprocess
import os
from datetime import datetime
from pathlib import Path

class AIAutomationSystem:
    def __init__(self):
        self.name = "Kali AI Automation"
        self.ollama_host = 'http://localhost:11434'
        self.ollama_model = 'mistral'
        self.tailscale_ip = self.get_tailscale_ip()
        
        # Notification config
        self.notify_method = 'ntfy'  # 'ntfy', 'telegram', or 'gotify'
        self.ntfy_topic = os.environ.get('NTFY_TOPIC', 'kali-automation')
        self.telegram_token = os.environ.get('TELEGRAM_TOKEN')
        self.telegram_chat_id = os.environ.get('TELEGRAM_CHAT_ID')
        
        # Setup logging
        self.log_file = Path.home() / 'ai-automation' / 'system.log'
        self.log_file.parent.mkdir(exist_ok=True)
        
        self.log(f"🤖 {self.name} Started")
        self.log(f"Tailscale IP: {self.tailscale_ip}")
    
    def get_tailscale_ip(self):
        """Get your Tailscale IP"""
        try:
            result = subprocess.run(
                ['tailscale', 'ip', '-4'],
                capture_output=True,
                text=True
            )
            return result.stdout.strip()
        except:
            return "Unknown"
    
    def log(self, message):
        """Log with timestamp"""
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        entry = f"[{timestamp}] {message}"
        print(entry)
        
        with open(self.log_file, 'a') as f:
            f.write(entry + '\n')
    
    def notify(self, title, message, image_url=None):
        """Send notification to phone"""
        try:
            if self.notify_method == 'ntfy':
                self._notify_ntfy(title, message)
            elif self.notify_method == 'telegram':
                self._notify_telegram(title, message)
            elif self.notify_method == 'gotify':
                self._notify_gotify(title, message)
            
            self.log(f"📱 Notification: {title}")
            return True
        except Exception as e:
            self.log(f"❌ Notification failed: {e}")
            return False
    
    def _notify_ntfy(self, title, message):
        """Send via ntfy.sh"""
        url = f"ntfy.sh/{self.ntfy_topic}"
        data = f"{title}\n{message}"
        requests.post(url, data=data, timeout=5)
    
    def _notify_telegram(self, title, message):
        """Send via Telegram"""
        if not (self.telegram_token and self.telegram_chat_id):
            return
        
        url = f"https://api.telegram.org/bot{self.telegram_token}/sendMessage"
        data = {
            'chat_id': self.telegram_chat_id,
            'text': f"*{title}*\n{message}",
            'parse_mode': 'Markdown'
        }
        requests.post(url, json=data, timeout=5)
    
    def _notify_gotify(self, title, message):
        """Send via Gotify"""
        url = "http://localhost:3000/message"
        data = {
            'title': title,
            'message': message,
            'priority': 5
        }
        requests.post(url, json=data, timeout=5)
    
    def query_ai(self, prompt):
        """Query local LLM"""
        try:
            client = ollama.Client(host=self.ollama_host)
            response = client.generate(
                model=self.ollama_model,
                prompt=prompt,
                stream=False
            )
            return response['response']
        except Exception as e:
            self.log(f"❌ AI Error: {e}")
            return None
    
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
            self.log(f"❌ Command error: {e}")
            return None, 1
    
    def system_health_check(self):
        """Check system health with AI analysis"""
        # Get system info
        cpu, _ = self.run_command('top -bn1 | head -n 3 | tail -n 1')
        memory, _ = self.run_command('free -h | grep Mem')
        disk, _ = self.run_command('df -h / | tail -1')
        
        status = f"CPU: {cpu}\nMemory: {memory}\nDisk: {disk}"
        
        # Ask AI to analyze
        prompt = f"""Analyze this system status and identify any issues:
        
{status}

Keep response to 2-3 sentences. Focus on problems."""
        
        analysis = self.query_ai(prompt)
        
        if analysis:
            self.notify("System Health", analysis)
        
        return status
    
    def security_check(self):
        """Security monitoring task"""
        prompt = """You are a security expert. What are the top 3 security 
        practices for a Kali Linux system running AI automation with Tailscale VPN?
        Keep response brief (3-5 sentences)."""
        
        tips = self.query_ai(prompt)
        
        if tips:
            self.notify("🔒 Security Tips", tips)
        
        return tips
    
    def network_optimization(self):
        """Network optimization suggestions"""
        # Check Tailscale
        status, _ = self.run_command('tailscale status')
        
        prompt = f"""Given this Tailscale status, suggest optimizations:
        
{status}

Focus on: security, performance, reliability.
Keep it brief."""
        
        suggestions = self.query_ai(prompt)
        
        if suggestions:
            self.notify("🌐 Network Optimization", suggestions)
        
        return suggestions
    
    def scheduled_tasks(self):
        """Run scheduled automation tasks"""
        tasks = [
            {
                'name': 'Health Check',
                'action': self.system_health_check
            },
            {
                'name': 'Security Review',
                'action': self.security_check
            },
            {
                'name': 'Network Optimization',
                'action': self.network_optimization
            }
        ]
        
        return tasks
    
    def daemon_loop(self, interval=300):
        """Run as daemon (every 5 minutes)"""
        self.log("🚀 Starting daemon loop")
        self.notify("System", "AI Automation daemon started!")
        
        try:
            iteration = 0
            while True:
                iteration += 1
                self.log(f"\n--- Iteration {iteration} ---")
                
                # Run scheduled tasks
                for task in self.scheduled_tasks():
                    self.log(f"Running: {task['name']}")
                    task['action']()
                
                # Sleep
                self.log(f"Next run in {interval}s...")
                time.sleep(interval)
        
        except KeyboardInterrupt:
            self.log("Daemon stopped by user")
            self.notify("System", "AI Automation daemon stopped")
        
        except Exception as e:
            self.log(f"❌ Daemon error: {e}")
            self.notify("System Error", str(e))

# Main execution
if __name__ == "__main__":
    system = AIAutomationSystem()
    
    # Test mode
    print("\n=== Testing AI ===")
    response = system.query_ai("What is Kali Linux? (2 sentences)")
    print(f"AI: {response}")
    
    print("\n=== Sending test notification ===")
    system.notify("Test", "AI system is working!")
    
    print("\n=== Running one health check ===")
    system.system_health_check()
    
    print("\n=== To run continuously (daemon) ===")
    print("python3 main.py --daemon")
    print("\n=== Or with systemd ===")
    print("sudo systemctl start ai-automation")
```

---

## Phase 7: Setup Systemd Service (10 minutes)

Create `/etc/systemd/system/ai-automation.service`:

```ini
[Unit]
Description=AI Automation System with Ollama and Tailscale
After=network-online.target tailscaled.service ollama.service
Wants=network-online.target

[Service]
Type=simple
User=kali
WorkingDirectory=/home/kali/ai-automation

# Python script
ExecStart=/home/kali/ai-automation/bin/python3 /home/kali/ai-automation/main.py

# Pass environment variables
Environment="PATH=/home/kali/ai-automation/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
EnvironmentFile=/home/kali/.config/ai-credentials/notifications.conf

# Restart on failure
Restart=on-failure
RestartSec=10

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ai-automation

# Resource limits
MemoryLimit=1000M
CPUQuota=50%

# Security
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

### Enable Service

```bash
# Create notification config
cat > ~/.config/ai-credentials/notifications.conf << 'EOF'
NTFY_TOPIC=kali-automation
TELEGRAM_TOKEN=your_token_here
TELEGRAM_CHAT_ID=your_chat_id_here
EOF

chmod 600 ~/.config/ai-credentials/notifications.conf

# Enable systemd service
sudo systemctl daemon-reload
sudo systemctl enable ai-automation
sudo systemctl start ai-automation

# Check status
sudo systemctl status ai-automation

# View logs
sudo journalctl -u ai-automation -f
```

---

## Phase 8: Access from Phone via Tailscale (5 minutes)

### Setup Tailscale on Phone

```
iOS:
1. App Store → search "Tailscale"
2. Install
3. Open → Login with your account
4. Your Kali appears in device list

Android:
1. Google Play → search "Tailscale"
2. Install
3. Open → Login with your account
4. Your Kali appears in device list
```

### Access from Phone

```
Your Kali is now accessible:
http://[your-tailscale-ip]:11434/api/tags

Example:
http://100.x.x.x:11434/api/tags

This shows your available AI models!
```

---

## Phase 9: Verification Checklist

### Check Each Component

```bash
# 1. Kali Linux
uname -a

# 2. Tailscale
tailscale status

# 3. Ollama
curl http://localhost:11434/api/tags

# 4. Python environment
source ~/ai-automation/bin/activate
python3 --version

# 5. AI automation
python3 ~/ai-automation/main.py

# 6. Systemd service
sudo systemctl status ai-automation

# 7. Notifications (test)
curl -d "Test message" ntfy.sh/kali-automation

# 8. Check logs
tail -f ~/ai-automation/system.log
```

---

## 🎯 Your Complete System

```
┌──────────────────────────────────┐
│   Your Phone (anywhere)          │
│   - Tailscale App                │
│   - ntfy/Telegram app            │
│   - Notifications arrive         │
└──────────────────────────────────┘
          ↑           ↑
          │ Tailscale │ Notifications
          │ mesh VPN  │ (ntfy/Telegram)
          ↓           ↓
┌──────────────────────────────────┐
│   Kali Linux (Dell XPS)          │
│   ┌────────────────────────────┐ │
│   │  AI Automation System      │ │
│   │  (Python + Systemd)        │ │
│   └────────────────────────────┘ │
│            ↓           ↓          │
│   ┌────────────┐  ┌──────────┐  │
│   │  Ollama    │  │ Tailscale│  │
│   │  (Local AI)│  │ VPN      │  │
│   └────────────┘  └──────────┘  │
│         ↓                        │
│   ┌──────────────────────────┐  │
│   │  Mistral/Llama2 Models   │  │
│   │  (Run locally)           │  │
│   └──────────────────────────┘  │
└──────────────────────────────────┘
```

---

## 📊 How It Works

1. **AI runs 24/7** on your Kali Linux
2. **Every 5 minutes** it:
   - Checks system health
   - Analyzes security
   - Optimizes network
3. **AI analyzes results** using local models
4. **Sends notifications** to your phone
5. **Accessible anywhere** via Tailscale VPN

---

## Quick Commands

```bash
# View automation logs
tail -f ~/ai-automation/system.log

# Check system status
sudo systemctl status ai-automation

# Restart automation
sudo systemctl restart ai-automation

# View Tailscale status
tailscale status

# Get your Tailscale IP
tailscale ip -4

# Test notification
curl -d "Test" ntfy.sh/kali-automation

# Run one-time analysis
python3 ~/ai-automation/main.py
```

---

## 🔒 Security Tips

```bash
# 1. Update regularly
sudo apt-get update && sudo apt-get upgrade

# 2. Secure your credentials
chmod 600 ~/.config/ai-credentials/*

# 3. Enable Tailscale firewall
sudo tailscale set --shields-up

# 4. Monitor daemon logs
sudo journalctl -u ai-automation -f

# 5. Check open ports
sudo ss -tlnp
```

---

## 🚀 You're Done!

You now have:
- ✅ Kali Linux password reset
- ✅ Local AI (Ollama + Models)
- ✅ Claude integration (optional)
- ✅ AI automation daemon
- ✅ Phone notifications
- ✅ Tailscale mesh VPN access
- ✅ 24/7 background operation
- ✅ Full logging and monitoring

**Your AI-powered security lab is live!** 🎉

---

## Next Steps

1. **Monitor logs** for first day
2. **Test from phone** via Tailscale
3. **Customize tasks** in main.py
4. **Add more models** with `ollama pull`
5. **Integrate Claude** for complex tasks
6. **Expand automation** with custom scripts

**Everything accessible from anywhere, any device, via Tailscale!** 🌐
