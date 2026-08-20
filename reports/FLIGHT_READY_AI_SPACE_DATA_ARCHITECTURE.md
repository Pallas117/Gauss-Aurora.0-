# Project Gauss — flight-readiness architecture report

Date: 2026-08-19
Scope: local-first AI/data architecture for spacecraft, cFS, Yamcs, CCSDS/XTCE,
PINN residual inference, radiation protection, and low-memory operation.

## Executive conclusion

Project Gauss has a credible deterministic ground and simulation foundation, but
it is not a flight-qualified autonomous system. The current implementation now
has the right integration seams for the next validation stage:

- a fixed-memory cFS-shaped C application boundary and host SIL test;
- an explicit Yamcs-facing packet envelope with CCSDS/XTCE upstream;
- a versioned radiation-assurance envelope that fails closed on stale,
  unqualified, malformed, or over-limit data;
- a self-contained SEC-DED Hamming(72,64) software codec and bounded fault
  injection tests;
- a deterministic MHD fixture and Cesium visualization for visual plumbing,
  with an SVG/low-power fallback.

These are engineering evidence, not mission assurance evidence. Flight use still
requires the selected cFS target, processor/FPGA, memory controller, radiation
environment, shielding, part lot, software assurance, and operator/mission
certification to be tested and reviewed as one system.

## What is implemented and verified

| Area | Evidence | Status |
|---|---|---|
| Deterministic MHD | `services/mhd-deterministic-cpp/`, JSON schema, Rust mirror | Host deterministic fixture only |
| cFS boundary | `services/cfs-gauss-mhd/`, fixed arrays, no allocation, reject/clamp paths | Host SIL pass; target adapter pending |
| CCSDS/XTCE | Existing Rust decoder, APID map, XTCE validation | Existing path; mission dictionary pending |
| Yamcs boundary | `gauss-orchestrator::telemetry::yamcs`, JSONL replay fixture | Adapter contract; live server pending |
| Radiation gate | `config/radiation-envelope.schema.json`, Rust evaluator | Fail-closed software gate |
| ECC | SEC-DED Hamming(72,64) in `telemetry/ecc.rs` | 72/72 single-bit corrections and 2,556/2,556 double-bit detections |
| Onboard tensor path | Fixed-shape contract and Cesium/SVG visualization | Runtime qualification and accelerator path pending |

## Architecture decision

Keep the safety path deterministic and bounded:

```text
CCSDS packet → cFS message → integrity/time/calibration gate
             → quality envelope → deterministic physics baseline
             → bounded frozen PINN residual → uncertainty/abstention
             → approval-gated action or store-and-forward record
```

Yamcs belongs on the ground/mission-data side of the boundary. JSON is retained
for ground interoperability and replay; cFS uses fixed-size binary messages and
static buffers. PINNs remain ground-trained and frozen onboard. ECC protects
software buffers/checkpoints, while the selected hardware ECC/EDAC controller
must provide the memory-system assurance.

## Radiation limitations

There is no universal “rad-hard chip limit”. TID, displacement damage, and
single-event effects depend on orbit, environment model, shielding, device,
lot, package, voltage, workload, and mission duration. The radiation envelope
therefore records measured/approved limits and references rather than treating a
generic number as a guarantee. NASA's RHA guidance requires mission environment
definition, part selection/testing, shielding/layout, tolerant design, and
requirements evidence:

- [NASA RHA guidelines, NASA/TM-20210018053](https://ntrs.nasa.gov/citations/20210018053)
- [NASA NEPP SEE/TID material](https://nepp.nasa.gov/files/26884/NSREC2014-SEE-TID-Poster-TN30287.pdf)
- [ESA radiation-hardness and testing work](https://www.esa.int/gsp/ACT/projects/radiation_hardness/)

Some NASA project pages cite example thresholds such as 100 krad(Si) and
100 MeV·cm²/mg for a specific FPGA effort. Those are program-specific examples,
not a product-wide guarantee:
[NASA TechPort FPGA radiation project](https://techport.nasa.gov/projects/8263).

The required next evidence is a reviewed radiation environment and part-level
test matrix covering TID, DDD, SEL, SEU/MBU, watchdog recovery, scrubbing,
checkpoint integrity, brownout, and thermal/power corners.

## Interoperability and comparable products

- [NASA cFS](https://github.com/nasa/cFS) supplies an open-source flight software
  framework; it does not provide Gauss's data-quality, model-governance, or
  radiation-assurance product.
- [Yamcs](https://yamcs.org/) provides an open-source mission-data core with
  CCSDS/XTCE support; enterprise support and mission customization are separate
  commercial considerations.
- [NASA F´](https://fprime.jpl.nasa.gov/overview/) is a flight-proven open-source
  C++ framework, complementary to cFS rather than a Yamcs replacement.
- [Unibap SpaceCloud](https://unibap.com/solutions/software/osfw/) and
  [Ubotica CogniSAT](https://ubotica.com/cognisat/) demonstrate the commercial
  onboard-compute/AI category. Their hardware, qualification, support, and
  integration pricing is quote-based.
- [CesiumJS](https://github.com/CesiumGS/cesium) is suitable for ground visual
  verification; local CesiumJS is distinct from paid Cesium ion hosting.

## Cost and pricing envelope

These are planning ranges, not vendor quotes:

| Package | Indicative price |
|---|---:|
| Ground proof-of-value: replay, quality gate, dashboard, local Yamcs | $40k–$90k fixed |
| Mission data-quality/Yamcs/XTCE integration | $150k–$350k |
| Annual ground platform and support | $75k–$250k/year |
| Flight-boundary integration NRE, excluding hardware/labs | $750k–$2.5M |
| Qualified mission integration and verification | $2.5M–$8M+ |
| Fleet enterprise support | $300k–$1.2M/year |

Recommended commercial posture: sell a $60k–$90k ground pilot, a
$200k–$350k mission integration package, and price flight qualification as a
separately scoped NRE/verification program. Do not price an unqualified
software-only build as radiation-hardened or autonomous flight control.

Actual infrastructure pricing remains parameterized by spacecraft count,
telemetry rate, contact gap, retention, model latency, availability, and
qualification target. Use:

```text
ingress = spacecraft × points/s × encoded bytes × protocol/replication overhead
hot storage = ingress × retention seconds × replication factor
archive = raw + calibrated + derived + backups + replay copies
compute = peak windows × model cost/window × failover factor
```

## Remaining blockers

1. Compile and verify the cFS adapter on the selected flight processor.
2. Run Yamcs with mission XTCE, authentication, archive, replication, and
   replay/conformance evidence.
3. Select hardware ECC/EDAC and complete radiation/fault-injection testing.
4. Populate radiation envelopes from independent test and environment records.
5. Demonstrate fixed-memory inference latency, link-loss behavior, recovery,
   signed artifacts, command inhibition, and operator approval paths.
6. Complete software, cybersecurity, configuration-management, and mission
   assurance reviews. No current test establishes flight readiness.

## Linear execution plan

The implementation work is tracked under the existing
[Orbital Interoperability (CCSDS + ONNX) project](https://linear.app/gausstalos/project/orbital-interoperability-ccsds-onnx-2d23d0df2c98):

1. cFS deterministic app boundary and target adapter.
2. Yamcs CCSDS/XTCE replay and mission dictionary conformance.
3. Radiation envelope and fail-closed action policy.
4. SEC-DED/ECC integration and hardware fault-injection evidence.
5. Fixed-memory tensor/PINN runtime and hardware-in-the-loop verification.

The report is intentionally explicit about the boundary between “implemented in
the repository” and “externally qualified”.
