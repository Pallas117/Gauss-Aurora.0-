---
record_type: paper
schema_version: rag-paper-v1
title: Software Development Standard for Space Systems
short_title: SMC-S-012 (2020)
report_number: TR-RS-2020-00012
authors:
  - Vale T. Sather
  - Heesoon E. Kim
  - Delores J. Harralson
  - Gloria E. Pugliese-Rosillo
publisher: The Aerospace Corporation
sponsor: Space and Missile Systems Center, United States Space Force
publication_date: 2020-07-10
source_url: https://s3vi.ndc.nasa.gov/ssri-kb/static/resources/AD1118393.pdf
local_artifact: software-development-standard-for-space-systems-2020.pdf
sha256: 0136c76d809f9e66cf19ebba6e47de0e3b78817a98d16b8446e8e03ac25d6c6b
distribution: public-release
language: en
domain:
  - space systems
  - software engineering
  - verification and validation
  - software assurance
  - cybersecurity
  - system safety
retrieval_tags:
  - SMC-S-012
  - space software lifecycle
  - configuration management
  - technical reviews
  - risk management
  - software measurement
  - requirements traceability
  - automated testing
  - qualification testing
  - software security
  - supply chain risk
  - transition to operations
  - maintenance
trust:
  approval_status: approved
  redaction_status: not_required
  sensitivity: public
  owner: gauss
  retention_policy: source_attribution
  index_allowed: true
---

# RAG record: Software Development Standard for Space Systems

## Abstract

The 2020 Aerospace Corporation report presents 95 method-agnostic software-development requirements for space-system acquisition. It applies to onboard vehicle software, launch and upper-stage software, ground operations, user equipment, test software, operations-support software, and firmware. The report is guidance until its tailored requirements are placed on contract; it is not by itself a certification or compliance determination.

## Scope and use

- Treat this record as a public, authoritative aerospace engineering reference.
- Use the companion PDF for page-accurate evidence and the structured sections below for retrieval.
- Preserve the source URL and SHA-256 digest when copying the artifact between offline nodes.
- Tailor the requirements to mission risk, lifecycle method, interfaces, and contract terms before implementation.

## Section map

| Section | Retrieval focus | Operational interpretation |
| --- | --- | --- |
| 1 | Scope, tailoring, compliance, precedence | Establish the acquirer/developer agreement and mission-specific tailoring. |
| 2 | Normative and supporting references | Link safety, systems engineering, quality, measurement, configuration, and lifecycle practices. |
| 3 | Definitions | Normalize terms such as software item, work product, qualification, safety, and maintenance. |
| 4 | Software work products | Retain and make development and test evidence retrievable across the lifecycle. |
| 5.1 | Planning | Record lifecycle, roles, processes, test environments, interfaces, performance, stress, recovery, and resource budgets. |
| 5.2-5.6 | Configuration, reviews, risk, measurement, teams | Control baselines, review decisions, risks, metrics, and team accountability. |
| 5.7-5.9 | Requirements, architecture, design | Maintain bidirectional traceability and document interfaces, constraints, trade studies, and database design. |
| 5.10-5.12 | Coding, unit, integration, qualification | Automate analysis and tests, cover boundaries and faults, preserve results, and use an operationally equivalent test environment. |
| 5.13-5.15 | Peer review, quality assurance, corrective action | Define entry/exit criteria, record defects, trend findings, and manage corrective action. |
| 5.16-5.17 | Security and system safety | Use secure coding, automated vulnerability analysis, program protection, supply-chain controls, and safety planning. |
| 5.18-5.19 | Transition and maintenance | Deliver configuration-managed executables, installation and operations information, licenses, source, build tools, and firmware procedures. |

## Requirement themes

### Evidence and lifecycle control

Retain work products from every development activity and make them viewable and retrievable by the acquirer. Test evidence should include environment preparation, test cases, procedures, drivers or scripts, and test data. Configuration identification, change control, status accounting, and audits are part of the baseline rather than optional documentation.

### Planning for networked and constrained systems

Test planning should cover internal and external interfaces, end-to-end capabilities, timing and accuracy, stress, startup/termination/restart, fault detection and recovery, data capture/reporting, and CPU, memory, storage, and bandwidth utilization. These themes map directly to Gauss network health, bounded autoscaling, store-and-forward operation, and device self-heal.

### Traceability and architecture

For each software item, record functional, non-functional, and interface requirements together with verification methods. Maintain bidirectional links among system/subsystem requirements, architecture, design, code, and qualification cases. Architecture records should cover static, dynamic, and physical views, quality attributes, constraints, trade studies, and decisions.

### Automated assurance

Use automated code analysis and automate unit, integration, regression, and qualification testing as far as practical. Unit tests should exercise branches, exceptions, interfaces, limits, boundary conditions, and algorithms. Qualification testing should use an operationally equivalent environment or interface simulation and be independently performed from detailed design and implementation.

### Security, safety, and supply chain

Secure coding, automated vulnerability analysis, program-protection planning, and supply-chain risk management are explicit lifecycle activities. The supply-chain view includes developed software, reused software, development tools, and the development environment. System safety is planned against the applicable safety standard and must be carried through operations.

### Transition and maintenance

Deliver software from configuration-managed sources with installation procedures, version and license information, user and computer operation guidance, training material, and maintenance build/test tooling. The as-built package should remain consistent with requirements, interface, architecture, and design records.

## Gauss implementation crosswalk

| Paper theme | Gauss evidence or next step |
| --- | --- |
| Resource and fault testing | Turing heartbeats capture memory, disk, load, battery, cache reachability, and network state; autoscaler tests cover bounded actions and cooldowns. |
| Recovery and approval | Managed self-heal is limited to approved non-spacecraft nodes; spacecraft actions require explicit approval. |
| Configuration and traceability | `development/memory/DECISIONS.md`, `docs/ARCHITECTURE.md`, Rust policy module, and backend reconciler provide the current decision/evidence boundary. |
| Automated assurance | `npm run develop:verify` is the repository scaffold gate; Rust, backend, UI, and compliance checks remain evidence-producing CI stages. |
| Security and supply chain | OIDC/JWKS staff federation, post-quantum gateway profile claims, per-device tokens, replay-resistant heartbeats, and dependency/compliance manifests are the current controls. |
| Transition readiness | Next work: authenticated provisioning, runbooks, failure drills, operator alerting, and closure of the known mesh broker test expectation. |

## Retrieval questions

- Which work products and test evidence should be retained for a space software lifecycle?
- What must a test plan cover for interfaces, faults, recovery, and constrained resources?
- How should requirements trace to architecture, design, code, and qualification cases?
- What security and supply-chain controls are required across development and tooling?
- What must be delivered for transition to operations and maintenance?
- Which SMC-S-012 themes map to Gauss device health, autoscaling, self-heal, and spacecraft approval gates?

## Citation

Sather, V. T., Kim, H. E., Harralson, D. J., and Pugliese-Rosillo, G. E. *Software Development Standard for Space Systems*. Aerospace Report No. TR-RS-2020-00012, Space and Missile Systems Center, United States Space Force, 10 July 2020. Public-release PDF: <https://s3vi.ndc.nasa.gov/ssri-kb/static/resources/AD1118393.pdf>.
