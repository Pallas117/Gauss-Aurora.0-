# Network adapters

Gauss exposes a read-only, transport-neutral adapter boundary for the local
host and the Tailscale overlay:

```text
local host (this MacBook) ── passive inventory ──┐
                                                  ├─ gauss-network-adapters-v1
Tailscale overlay ── observed peer facts ────────┘
```

The backend endpoint is `GET /api/ops/network/adapters` and requires the
operator role. It invokes the existing bounded
`scripts/turing/network-inventory.py` collector once per five-second cache
window, then projects the result through two adapters:

The response contract is versioned at
`config/network-adapters.schema.json`.

- `local-host` describes the machine running the backend, its interfaces, and
  its observed Tailscale address.
- `tailscale-overlay` describes the local host plus observed `100.64.0.0/10`
  peers from `tailscale status --json`.

Enrolled Tailscale devices can optionally attach their own passive inventory
to the existing authenticated heartbeat:

```sh
TURING_NETWORK_INVENTORY_ENABLED=true \
TURING_NETWORK_INVENTORY_INTERVAL_SEC=300 \
./scripts/turing/device-agent.sh
```

The device agent keeps this disabled by default and only sends the bounded
collector payload; it does not grant the backend a shell, route access, or
active discovery permission.

The default is passive collection. Presence, online state, or a Tailscale
address is not enrollment, approval, service health, or permission to issue
work. Active TCP probes remain disabled unless an operator separately supplies
the existing explicit CIDR/port allow-list and approval settings to the
collector. This adapter layer performs no route, firewall, credential, or
remote-service mutation.

If the collector cannot run or its payload fails validation, the affected
adapter reports `blocked`; collector warnings remain visible as `degraded`
signals. This keeps missing local Tailscale access honest instead of presenting
an empty peer list as proof that the overlay is healthy.
