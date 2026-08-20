# Device installation and web onboarding

This is the cross-device flow for Mac, Linux/Kali, Android/phones, server racks,
and spacecraft-simulated nodes. A browser session is an operator surface; it is
not itself a health agent. A device agent is installed separately and receives
only the narrow Turing enrollment and heartbeat authority.

## Trust boundaries

1. The staff web app authenticates the user through the configured OIDC/JWKS
   identity boundary. Post-quantum status is asserted by the configured gateway;
   an ordinary browser JWT is not called post-quantum secure by itself.
2. An operator requests a short-lived, one-use join code from
   `POST /api/turing/join-code`. The web UI must display the expiry and never
   persist the code in application storage or logs.
3. The user installs the device agent and provides the code locally. The agent
   registers through the Tailscale/HTTPS backend boundary and receives a
   per-device token once. The token belongs in Keychain (macOS), a mode-0600
   user secret (Linux), or Android Keystore; it must not be placed in a URL,
   shell history, telemetry, or source control.
4. The backend accepts heartbeats only with that device token. A valid join code
   may auto-approve enrollment; shared-secret enrollment remains a managed
   service path and otherwise stays pending for operator approval.
5. Health, cache, compute, and network-inventory capabilities are independent.
   A heartbeat never grants deployment, shell, firewall, Turing admission, or
   spacecraft-command authority. Active network probes remain separately
   allow-listed and approved.

## User flow

### Web-only user

The browser can view instructions and device status, but cannot report the
browser's battery/RAM as a trusted Turing node. Show an **Add device** CTA and
keep the onboarding step incomplete until an enrolled device has a fresh
heartbeat. The current UI's “I've added a device” action is a convenience flag,
not proof of registration; a future enrollment-session endpoint should replace
that manual confirmation.

### Desktop app (macOS)

The installer should:

- join or verify the user's Tailscale identity;
- ask for a one-time join code via a local paste/QR flow;
- store the returned device token in Keychain;
- install a user LaunchAgent for the bounded Turing health agent and cache
  service only when the user selects those capabilities;
- expose start/stop/status and a visible revoke path.

The Judith development supervisor is a different, local-only LaunchAgent. It
must not be silently bundled with a general user installation. macOS may deny
LaunchAgents access to a repository under `~/Documents`; the installer must
surface that failure and ask the user to grant access or choose a permitted
development directory rather than weakening macOS controls.

### Linux/Kali laptop

Use `npm run turing:device:bootstrap -- --ssh-target user@100.x.y.z
--backend-url https://<tailnet-backend> --join-code <one-time-code>` from an
operator workstation. The bootstrap verifies Tailscale, Python, curl, and
user-level systemd, then installs `gauss-turing-agent.service` and
`gauss-turing-cache.service`. `loginctl enable-linger` is an explicit operator
choice for operation after logout; it is not enabled implicitly.

Do not install the services until the backend health endpoint is reachable and
the approved network-only environment is present. A unit that cannot enroll
would only create retry noise and false confidence.

### Android/phone and server-rack nodes

The native agent follows the same register/heartbeat contract. Use Android
Keystore or the platform secret store, default to passive inventory, and apply
the battery/memory admission floors before volunteering cache or compute. Phones
should default to store-and-forward telemetry and no cache/compute service.

### Spacecraft-simulated nodes

Use the same protocol with `device_class=spacecraft` and explicit DTN/CCSDS
transport metadata. Evidence remains observe-only; no device enrollment or
heartbeat can authorize an uplink or flight command.

## Web implementation sequence

1. Authenticated operator opens **Add device** and requests a join code.
2. UI renders platform-specific instructions or a short-lived QR/deep link;
   code contents are never sent to Slack, Linear, or analytics.
3. Agent registers and stores its token, then sends an immediate heartbeat.
4. UI polls a bounded enrollment status view showing `pending`, `approved`,
   `fresh heartbeat`, and capability/resource evidence.
5. On a fresh heartbeat, the UI marks the device step complete. On expiry,
   revoke, stale, or offline state it keeps the step visible and offers a new
   code/revoke path.
6. Operator approval remains separate from notification channels. Slack can
   report status but cannot approve, deploy, heal, or command a device.

## Current repository readiness

- Existing registration, heartbeat, join-code, approval/revoke, health, heal,
  network-inventory, cache, and compute contracts are in `backend/turing/` and
  `/api/turing/*`.
- `src/components/onboarding/JoinNetworkOnboarding.tsx` already presents a
  web join-code flow and Linux bootstrap hint; it still needs an enrollment
  session/status contract before it can prove that a user's device is online.
- The Mac Judith supervisor installer now has an explicit `install` and
  `uninstall` command. Current runtime activation is blocked until the
  Documents access and disk-pressure issues are resolved and an independent
  `launchctl` check shows an active cycle.
- The Kali host is reachable over SSH and has user systemd, but its backend and
  Turing listener are not running. Do not bootstrap a retrying device service
  until the backend URL, restricted ingress, and approved enrollment credential
  are live.

## Verification contract

An installation is **READY** only when all of these are observed independently:

- service manager reports the expected unit loaded and active;
- device registration returns a device id and one-time token;
- backend receives a fresh authenticated heartbeat;
- device health endpoint is reachable over the approved transport;
- device appears with the expected class/capabilities and approval status;
- revoke/stop removes it from scheduling within the documented stale window.

Anything less is `unknown` or `blocked`, not an installed production agent.
