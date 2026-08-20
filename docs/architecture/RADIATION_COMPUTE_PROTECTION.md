# Radiation-aware compute protection

## Alignment conclusion

Project Gauss is aligned with the supplied architecture material when it is treated as a radiation-aware, quality-gated automation system rather than as a claim that orbital megawatt-scale AI data centers are solved.

The practical near-term target is bounded onboard inference and event filtering on a mission-qualified platform, with heavier training, replay, calibration, and fleet optimization on the ground. The Cesium MHD view is a deterministic visualization and data-contract probe; it is not a radiation model, a qualification test, or a command authority.

The supplied RazakSAT and RatSat documents are useful forensic design context: they emphasize that launch success does not prove system integration, orbit selection changes radiation exposure, and untested COTS processors can be the mission-limiting component. Their numerical claims are treated as source-specific hypotheses until independently traced to mission records, radiation test reports, or a verified environment model.

## What limits rad-hard compute

There is no universal “rad-hard chip limit.” The limit is a qualified requirement for a particular part, lot, shielding configuration, orbit, mission duration, solar-cycle assumption, and workload. NASA radiation-hardness assurance separates at least:

- total ionizing dose (TID), which accumulates and can shift device parameters or increase leakage;
- displacement damage dose (DDD), especially relevant to optoelectronics, sensors, and bipolar devices; and
- single-event effects (SEE), including transient upsets, multiple-bit upsets, latch-up, burnout, and gate rupture.

NASA’s RHA guidance requires environment definition, part selection, part testing, spacecraft layout, radiation-tolerant design, and mission/subsystem requirements. A NASA FPGA technology project uses 100 krad(Si) TID and 100 MeV cm²/mg SEL immunity as example program requirements; those figures are not a generic acceptance threshold for every spacecraft.

The working requirement for Gauss should therefore be a per-mission radiation envelope:

```text
environment model + shielding geometry + mission duration + margin
        → TID / DDD / SEE requirement
        → device test evidence and lot traceability
        → software operating policy
```

## Protection stack for Gauss

1. Environment and shielding: calculate trapped-proton/electron, solar-particle, and heavy-ion exposure for the actual orbit and duration. Use enclosure and spot shielding, but do not assume aluminium makes SEE impossible; shielding can create secondary particles and cannot stop every single-particle event.
2. Hardware assurance: select devices with mission-relevant TID, DDD, and SEE test data. Record part, lot, process, package, bias, temperature, test beam, fluence, LET threshold/cross-section, SEL/SEB/SEGR results, and post-irradiation drift.
3. Memory and state: ECC plus scrubbing for correctable memory, protected configuration storage, CRC/hash checks, watchdogs, brownout/over-current protection, latch-up power cycling, partitioned state, and bounded checkpoint/restart.
4. Compute policy: schedule inference only when power, temperature, radiation state, memory integrity, and telemetry quality are nominal. Reduce duty cycle or use the deterministic baseline during high-risk passages. Do not train or update weights autonomously onboard.
5. AI resilience: use compact quantized models with bounded activations, signed immutable artifacts, deterministic pre/post-condition checks, champion/baseline comparison, uncertainty thresholds, and explicit abstention. A model output cannot override a radiation or hardware-health inhibit.
6. Fleet resilience: keep replayable checkpoints and summarized products locally, store-and-forward across DTN links, and move non-critical jobs to a healthy spacecraft or ground node when contact and authorization permit.
7. Verification: inject SEUs and multiple-bit faults into memory and model buffers; test watchdog recovery, checkpoint integrity, thermal throttling, power shedding, and safe fallback under representative TID/DDD/SEE-derived rates. Radiation tests remain hardware qualification work, not software simulation evidence.

## Required data contract

The next flight-boundary contract should add a signed, versioned radiation envelope beside the existing telemetry quality fields:

```text
radiation.schema = gauss-radiation-envelope-v1
radiation.environment_model_version
radiation.tid_krad_si_estimate
radiation.ddd_margin
radiation.see_rate_estimate
radiation.let_threshold_mev_cm2_mg
radiation.sel_status = nominal | elevated | inhibited | unknown
radiation.shielding_configuration
radiation.part_qualification_reference
radiation.last_scrub_at
radiation.last_checkpoint_hash
radiation.action_policy = nominal | derate | checkpoint | safe_mode | abstain
```

The C++ deterministic MHD fixture can exercise the envelope plumbing, but it must not synthesize qualification evidence. The Rust orchestrator should reject an action-critical inference when the envelope is stale, unknown, unqualified, or inconsistent with the model and hardware manifest.

## What the repository can and cannot claim

The repository can implement deterministic data quality gates, radiation-state policy, fixed-memory inference buffers, checkpoint/replay, fault injection, Cesium/SVG visualization, and auditable ground/onboard interfaces.

It cannot establish a chip’s radiation limit, certify a COTS GPU, prove a rad-hard process, or replace beam testing and mission radiation analysis. Hardware qualification and flight readiness remain external evidence gates.

## Primary references

- NASA NESC, *Avionics Radiation Hardness Assurance (RHA) Guidelines*: https://ntrs.nasa.gov/citations/20210018053
- NASA NEPP, *Compendium of Single Event Effects, Total Ionizing Dose, and Displacement Damage*: https://nepp.nasa.gov/files/26884/NSREC2014-SEE-TID-Poster-TN30287.pdf
- NASA TechPort, *Radiation Mitigation Methods for Reprogrammable FPGA*: https://techport.nasa.gov/projects/8263
- ESA, *Radiation-Hardness Components at scaled technology nodes*: https://www.esa.int/gsp/ACT/projects/radiation_hardness/
- ESA, *New radiation testing for missions*: https://www.esa.int/Enabling_Support/Space_Engineering_Technology/Shaping_the_Future/New_radiation_testing_for_missions
