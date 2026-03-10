# Network Security + Connectivity Strategy

As of **February 24, 2026**, this repo supports a local automation agent for secure mobile development and resilient connectivity.

## 1) Primary/Secondary Connectivity Policy

- Primary: personal hotspot (`GAUSS_PRIMARY_HOTSPOT_SSID`)
- Secondary: trusted Wi-Fi (`GAUSS_SECONDARY_WIFI_SSID`)
- VPN overlay: Tailscale (must be running for secure remote access)

Automation command set:

```bash
npm run network:secure
npm run network:secure:apply
npm run network:secure:watch
```

What the agent does:

- Checks security posture (`AUTH_REQUIRED`, `CYBERTIGER_ENABLED`, firewall state, origin safety).
- Checks connectivity posture (internet probe + Tailscale state + SSID visibility/selection).
- Optionally reorders macOS network services and switches SSID.
- Sends Telegram approval prompts before disruptive network changes (unless bypass/auto-approve is set).
- Writes continuous feed artifacts:
  - `reports/network/connectivity-feed.jsonl`
  - `reports/network/connectivity-latest.json`

## 2) Telegram Approval Flow

For change-control on mobile/public networks:

- Configure `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
- Agent sends request IDs for actions.
- Install `jq` for automatic approval polling (`brew install jq` on macOS).
- Reply:
  - `/approve <request_id>`
  - `/deny <request_id>`

## 3) Tertiary Path: Satellite-to-Mobile Options

Use these as tertiary fallback options when hotspot + Wi-Fi are unavailable:

1. Carrier-integrated direct-to-cell (broadest near-term path)
   - T-Mobile satellite service (text + data positioning):
     - [T-Mobile satellite (consumer)](https://www.t-mobile.com/coverage/satellite-phone-service)
     - [T-Satellite business](https://www.t-mobile.com/business/solutions/business-internet-services/tsatellite)
2. Broadband direct-to-device via AST SpaceMobile (operator partnerships)
   - [AST SpaceMobile](https://ast-science.com/)
3. Satellite messaging fallback on mainstream devices (device/OEM constrained)
   - [Apple satellite messaging and Emergency SOS](https://support.apple.com/en-us/120930)

## 4) Practical Recommendation

- Keep hotspot + Wi-Fi automation as the day-to-day path.
- Keep Tailscale as the mandatory encrypted control plane.
- Start tertiary evaluation with carrier-integrated direct-to-cell plans in your operating countries first, then evaluate dedicated satcom integrations.

## 5) Turing pool (Tailscale devices)

Devices on the same Tailscale tailnet can register as **Turing** nodes to provide in-memory cache and compute. The app shows their health at **/turing**. See [TURING_TAILNET_DEVICES.md](TURING_TAILNET_DEVICES.md) for register/heartbeat, cache and compute contracts, and environment variables.
