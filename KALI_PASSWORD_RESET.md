# Kali Linux Password Reset Guide

## 🔐 Reset Your Forgotten Password

**Time Required: 10-15 minutes**

---

## Method 1: GRUB Boot Menu (Recommended)

### Step 1: Reboot Kali Linux

```bash
# If currently logged in somewhere:
sudo reboot

# Or restart from power button
```

### Step 2: Access GRUB Menu

When computer boots up:

1. **Turn on Dell XPS**
2. **Immediately hold Shift key** (hold throughout startup)
3. You should see **GRUB menu** appear
4. You'll see list of boot options

### Step 3: Edit Boot Parameters

```
In GRUB menu:
1. Select first Linux option (usually highlighted)
2. Press 'e' to edit
3. Find the line starting with "linux"
   It looks like: linux /boot/vmlinuz-... ro quiet splash
4. Go to end of that line
5. Add: init=/bin/bash
   (Remove "ro" if present, or change to "rw")
6. Press Ctrl+X or F10 to boot

You should get a bash prompt (root shell)
```

### Step 4: Remount Filesystem

```bash
# Make filesystem writable
mount -o remount,rw /

# Verify it's writable
touch /test_file && rm /test_file
# Should work without errors
```

### Step 5: Reset Password

```bash
# Open password editor
passwd kali
# OR if kali is different user:
passwd username

# Enter new password twice
# You'll be prompted: Enter new UNIX password:
# Re-type new UNIX password:
```

### Step 6: Boot Normally

```bash
# Reboot
exec /sbin/init 6
# OR
reboot
```

### Step 7: Login

```bash
# Use your new password
Username: kali
Password: [your new password]
```

---

## Method 2: Live USB Boot (If GRUB Fails)

### Prerequisites

You need:
- USB drive with Kali Linux ISO
- Another computer to create USB
- ~5GB space

### Create Kali Live USB

On another computer:

```bash
# Download Kali ISO
# From: https://www.kali.org/get-kali/

# On macOS/Linux:
# 1. Insert USB drive
# 2. Find device name: diskutil list
# 3. Create live USB:
sudo dd if=/path/to/kali.iso of=/dev/diskX bs=4m
# (Replace X with your USB device number)

# On Windows:
# Download Etcher: https://www.balena.io/etcher/
# Select ISO → Select USB → Flash
```

### Boot from USB

On Dell XPS:

```
1. Insert USB drive
2. Power on Dell XPS
3. Immediately press F12 (or Del, Esc) repeatedly
4. Select USB drive from boot menu
5. Press Enter to boot from USB
6. Wait for Kali Linux live session to load
```

### Access Your Hard Drive

```bash
# After live session loads:
# 1. Open Terminal
# 2. List drives:
lsblk

# 3. Mount your drive:
sudo mkdir -p /mnt/kali
sudo mount /dev/nvme0n1p1 /mnt/kali
# (Replace nvme0n1p1 with your actual partition)

# 4. Chroot into your system:
sudo chroot /mnt/kali

# 5. Reset password:
passwd kali

# 6. Exit:
exit
exit

# 7. Reboot:
sudo reboot
# (Remove USB before it fully boots)
```

---

## Method 3: Single User Mode (If Both Above Fail)

### Boot Parameters

```
At GRUB menu:
1. Press 'e' to edit
2. Find "linux" line
3. Replace "splash quiet" with "single"
4. Press Ctrl+X

You'll boot to maintenance/single-user mode
```

### Reset Password

```bash
# You might be in root already
passwd kali

# If prompted for old password and you don't know it:
# You're in single-user mode, should not need old password

# Reboot
reboot
```

---

## Method 4: Reinstall (Last Resort)

If all methods fail:

### Back Up Your Files

```bash
# Use Kali live USB
# Mount drive
sudo mount /dev/nvme0n1p1 /mnt/kali
# Copy important files to USB
```

### Reinstall Kali

```bash
# Download Kali installer ISO
# Create bootable USB
# Boot from USB
# Choose "Install" (not live)
# Follow installer
# When prompted for password, create new one
# Complete installation
```

---

## Quick Troubleshooting

### Issue: GRUB Menu Doesn't Appear

**Solution:**
```bash
# Try holding different keys:
- Shift (most common)
- Esc
- Space

# Or wait after POST screen and look for "GNU GRUB"
```

### Issue: "init=/bin/bash" Doesn't Work

**Solution:**
```
# Try instead:
systemd.unit=rescue.target
# Or:
rd.break console=tty0

# Then:
mount -o remount,rw /sysroot
chroot /sysroot
passwd
exit
exit
```

### Issue: Permission Denied After chroot

**Solution:**
```bash
# Make sure filesystem is writable:
mount -o remount,rw /

# Check:
touch /test && rm /test
```

### Issue: User "kali" Doesn't Exist

**Solution:**
```bash
# List users:
cat /etc/passwd

# Find your username
passwd your_actual_username
```

---

## ✅ Verification

After reset, verify:

```bash
# Login with new password
# Should work without errors

# Check sudo access
sudo whoami
# Should output: root

# No password issues
sudo ls /root
# Should list files in /root
```

---

## 🔒 Prevent Future Password Loss

```bash
# Write password in secure location:
# 1. Physical notebook
# 2. Password manager (Bitwarden, 1Password)
# 3. Encrypted file on USB

# Enable keyfile recovery (optional):
# Create recovery keyfile during installation
```

---

## Security Note

**Never forget to secure your system after password reset!**

```bash
# Change SSH keys if you use SSH
ssh-keygen -t ed25519 -C "kali@xps"

# Update all packages
sudo apt-get update
sudo apt-get upgrade -y

# Enable firewall
sudo ufw enable

# Check sudo logs
sudo journalctl -xe | grep sudo
```

---

## Recommended: Use Password Manager

After you regain access:

```bash
# Install Bitwarden (open source)
# Or KeePass / KeePassXC (offline password manager)

sudo apt-get install keepassxc

# Store your passwords safely:
# - Kali login password
# - Tailscale credentials
# - AI/LLM API keys
# - Phone notification tokens
```

---

## Summary

| Method | Difficulty | Time | Success Rate |
|--------|-----------|------|--------------|
| GRUB Edit | Easy | 5 min | 95% |
| Live USB | Medium | 15 min | 90% |
| Single User | Hard | 10 min | 80% |
| Reinstall | Very Hard | 30 min | 100% |

**Try Method 1 (GRUB) first - it works most of the time!**

---

## Next Steps

Once you're back in:

1. ✅ Change password
2. ✅ Update system: `sudo apt-get update && sudo apt-get upgrade`
3. ✅ Install Tailscale: `curl -fsSL https://tailscale.com/install.sh | sh`
4. ✅ Proceed to AI setup guides

**Got back in? Great! Ready for the AI automation setup?** 🚀
