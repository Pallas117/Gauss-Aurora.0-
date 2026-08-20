# Turing network inventory

The Turing device agent can send a bounded inventory of what an enrolled node
can observe. It is designed for operations automation (health, topology hints,
and approval workflows), not for unrestricted discovery.

Inventory is per enrolled node: to cover networks reachable only from another
device, install the agent on that device as well. The backend does not silently
scan through peers or treat a peer's presence as permission to inspect its
network.

## Collection modes

- `passive` (the default) reports local interface addresses and CIDRs, route
  destinations, neighbor addresses/states, and approved Tailscale peer facts.
- `approved` adds TCP reachability checks only when all of the following are
  true: `TURING_NETWORK_DISCOVERY_APPROVED=true`, an explicit CIDR allow-list,
  and an explicit port allow-list are supplied. Target and probe counts are
  bounded by `TURING_NETWORK_DISCOVERY_MAX_TARGETS` and
  `TURING_NETWORK_DISCOVERY_MAX_PROBES`.

The collector connects and closes a TCP socket; it does not grab banners,
capture packets, enumerate processes, read credentials, or mutate routes and
firewalls. A node must be enrolled and authenticated before its heartbeat is
accepted. Keep inventory enabled only on devices and networks the operator is
authorized to administer.

## Agent configuration

```sh
TURING_NETWORK_INVENTORY_ENABLED=true \
TURING_NETWORK_DISCOVERY_MODE=passive \
./scripts/turing/device-agent.sh
```

For an explicitly approved probe set, use narrow ranges and ports:

```sh
TURING_NETWORK_INVENTORY_ENABLED=true \
TURING_NETWORK_DISCOVERY_MODE=approved \
TURING_NETWORK_DISCOVERY_APPROVED=true \
TURING_NETWORK_DISCOVERY_CIDRS=100.100.10.0/29 \
TURING_NETWORK_DISCOVERY_PORTS=22,443,8090 \
TURING_NETWORK_DISCOVERY_MAX_TARGETS=32 \
TURING_NETWORK_DISCOVERY_MAX_PROBES=96 \
./scripts/turing/device-agent.sh
```

The default inventory refresh interval is five minutes. Inventory is carried
inside the authenticated `/api/turing/heartbeat` payload and is kept in a
bounded in-memory store on the backend. The backend limits the number of
interfaces, routes, peers, neighbors, probes, policy entries, errors, and the
overall payload size (64 KiB).
The interoperable payload contract is versioned in
`config/network-inventory.schema.json`.

## Operator API and automation signals

Operator-role endpoints expose summaries and, when needed, a single full
inventory:

- `GET /api/ops/turing/network-inventory`
- `GET /api/ops/turing/devices/:id/network-inventory`

Summaries include freshness, counts, mode, authorization, and safe signals:
`inventory_stale`, `active_discovery_not_authorized`,
`probe_results_present`, `inventory_truncated`, and `collector_errors`.
Automation may use these signals to schedule a review, retry a heartbeat, or
select a healthier node. It must not infer permission to change network policy
from inventory alone; route, firewall, enrollment, and device-removal actions
remain separate operator-approved operations.

## Privacy and retention

MAC addresses, public keys, packet captures, credentials, process lists, and
service banners are intentionally excluded. Inventories are held in the
backend's current in-memory pool and are removed when a device is removed or
re-enrolled. Do not forward raw inventories to chat, issue trackers, or logs.
