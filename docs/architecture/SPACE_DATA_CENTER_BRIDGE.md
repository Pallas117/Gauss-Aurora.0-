# Federated space data-center bridge

## Purpose

Gauss can share data and bounded compute across LEO, MEO, GEO, ground, and
lunar-simulator nodes, but it must not behave like a globally shared memory
pool. Each node owns its local data and compute budget. The bridge exchanges
signed, encrypted, content-addressed products and short-lived compute leases.

The checked-in ground simulation is
`config/space-data-center-bridge.json`, validated against
`config/space-data-center-bridge.schema.json`.

## Boundary model

```text
LEO producers → MEO bridge/compute → GEO relay → ground Yamcs/archive
                         │                 └────→ operator gateway
                         └──────────────→ lunar relay simulator
```

This is a bridge and protection layer, not a replacement for a lunar relay
constellation. The lunar path must use a LunaNet-compatible service profile and
CCSDS DTN behavior when a real provider is available.

## Data-sharing contract

Only these product classes cross a bridge by default:

- immutable raw CCSDS packet;
- calibrated telemetry product;
- radiation and memory-integrity assessment;
- fixed-shape analytics tensor window;
- signed deterministic recommendation.

Every product requires a SHA-256 content identifier, encryption, source and
generation timestamps, schema/calibration/model versions, freshness policy, and
replication count. Raw packets remain recoverable even if a derived product is
discarded or a model abstains.

## Compute contract

Compute is dispatched as a bounded lease, never as an open remote execution
channel. A lease requires:

1. authenticated and approved node identity;
2. fresh memory, power, thermal, network, and radiation evidence;
3. a maximum input byte count and expiry;
4. a declared capability and model version;
5. deterministic input and output hashes;
6. release of input windows after completion or expiry;
7. deterministic local fallback if the lease fails.

Online weight training is disabled. A frozen residual model may run only beside
the deterministic physics/data-quality baseline and may be rejected by the
quality, radiation, uncertainty, or latency gates.

## Trust zones

The bridge separates:

- LEO fleet producers;
- MEO relay and compute;
- GEO relay;
- lunar relay or lunar simulator;
- ground archive and operator gateway.

No zone has command authority in the IOD profile. Operator approval is required
for recommendations, configuration changes, model changes, lease policy, and
any future command integration.

## Protection behavior

The bridge must fail closed when:

- a link is stale or unavailable;
- a bundle exceeds the link or node payload ceiling;
- radiation state is stale, unknown, or inhibited;
- memory integrity or watchdog evidence is missing;
- a node exceeds its RAM, queue, battery, thermal, or lease budget;
- a checksum, signature, provenance, schema, or calibration check fails;
- a model uncertainty or latency limit is exceeded.

The safe action is to retain raw context, use the deterministic baseline, store
and forward later, or abstain. It is never to silently promote an inferred
value or issue a spacecraft command.

## IOD implementation sequence

1. Run the checked-in bridge profile entirely on the ground with Yamcs replay.
2. Add a simulated LEO producer, MEO bridge, GEO relay, and lunar relay node.
3. Inject contact gaps, duplicate bundles, corrupted payloads, stale radiation,
   memory faults, queue pressure, and worker loss.
4. Measure end-to-end latency, memory, queue growth, retention, bundle expiry,
   replay determinism, and abstention behavior.
5. Move one bridge node to a hardware-in-the-loop target.
6. Only then select a hosted-payload or flight-candidate interface.

## What this does not prove

The ground profile does not prove orbital link budgets, radiation hardness,
space-qualified hardware, LunaNet service certification, spectrum authority,
or spacecraft command safety. Those remain external mission-assurance gates.
