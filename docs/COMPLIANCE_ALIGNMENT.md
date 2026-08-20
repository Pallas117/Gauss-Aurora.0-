# Compliance Alignment and CI Evidence

Last reviewed: 2026-07-16

## Scope

This is a technical alignment record for Project Gauss software, ground-segment services, operator task packets, and the development supply chain. It is not an ISO certification, a CCSDS conformance certificate, a NIST authorization, or a legal opinion about GDPR applicability.

“CSDSS” in the original request is interpreted as CCSDS (Consultative Committee for Space Data Systems).

The machine-readable source inventory and control tests live in [`compliance/requirements.json`](../compliance/requirements.json). Run `npm run compliance:check -- --online` to verify official source markers and repository evidence.

## Source baseline

| Authority | Current source used by CI | Alignment use |
| --- | --- | --- |
| ISO | [ISO/IEC 27001:2022](https://www.iso.org/standard/27001?browse=tc) + [Amd 1:2024](https://www.iso.org/standard/88435.html) | ISMS governance, risk, access, logging, monitoring, continual improvement. |
| ISO | [ISO/IEC 27002:2022](https://www.iso.org/standard/75652.html) | Control implementation guidance. |
| ISO | [ISO/IEC 27701:2025](https://www.iso.org/standard/27701?browse=tc) | Privacy information management for PII controllers/processors. |
| NIST | [CSF 2.0 / CSWP 29](https://www.nist.gov/publications/nist-cybersecurity-framework-csf-20) | Govern, Identify, Protect, Detect, Respond, Recover outcomes. |
| NIST | [SP 800-53 Rev. 5](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final) and [SP 800-53A](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final) | Security/privacy controls and assessment procedures; CI tracks release 5.2.0 markers. |
| NIST | [SSDF publications](https://csrc.nist.gov/projects/ssdf/publications) | Secure development, provenance, vulnerability response, and supply-chain evidence. |
| NIST | [IR 8270](https://csrc.nist.gov/pubs/ir/8270/final), [IR 8401](https://csrc.nist.gov/pubs/ir/8401/final), [IR 8441](https://csrc.nist.gov/pubs/ir/8441/final) | Commercial satellite, command-and-control, and hybrid-network cybersecurity context. |
| CCSDS | [Active publications](https://ccsds.org/publications/allpubs/) and [Blue Books](https://ccsds.org/publications/bluebooks/) | Space data-link security, authentication credentials, key management, and interoperable protocol evidence. |
| EU | [Regulation (EU) 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng) | GDPR principles, privacy by design, processor duties, records, security, breach response, DPIA, and transfers. |

## Control alignment

The CI report groups controls by the evidence that can be tested in this repository:

| Control group | Repository evidence | Enforcement |
| --- | --- | --- |
| Governance and ownership | Baseline, durable decisions, compliance workflow. | Blocking |
| Identity and access | Auth middleware, role-gated security/operations routes. | Blocking |
| Auditability | CyberTiger security events, request IDs, audit surfaces. | Blocking |
| Network boundaries | Rate limiting and security response headers. | Blocking |
| CCSDS telemetry | Rust decoder implementation and fixtures/tests. | Blocking |
| Privacy-by-design | Supabase RLS migrations and security headers. | Blocking |
| Secure development | CI installs, tests, lint, dependency audit, and lockfile. | Blocking |
| Operator safety | Typed task packets and explicit human approval gates. | Blocking |
| CCSDS SDLS/authentication/key management | Source alignment and gap ownership are documented; full flight/ground cryptographic conformance is not claimed. | Advisory gap |
| GDPR records/DPIA/lawful basis | Article 30 records of processing, DPIA ownership, and lawful basis artifacts are identified but not inferred from code. | Advisory gap |
| GDPR breach response | Article 33 requires assessment and notification within 72 hours where applicable; the operational DPA workflow remains organizational work. | Advisory gap |
| GDPR processors/transfers | Article 28 processor contracts and Article 44–49 international transfers safeguards require an accountable owner and evidence outside source code. | Advisory gap |

## CI behavior

- `npm run compliance:check` runs offline manifest and repository-control checks.
- `npm run compliance:check -- --online` fetches official source pages, verifies version markers, records content hashes, and writes a freshness report without copying standards text.
- `--strict` fails blocking control failures and source fetch/marker failures.
- `--fail-on-warn` is available for a release/certification gate when advisory gaps must also block.
- Reports are generated under `reports/compliance/`; they are evidence snapshots, not durable memory.

EUR-Lex may answer automated requests with HTTP 202 while presenting a browser verification step. CI records that as a warning and never treats it as proof that the legal text was refreshed; the canonical EUR-Lex link remains in the manifest and requires manual review until an approved official fallback is configured.

The system intentionally distinguishes a tested technical control from a legal or certification conclusion. Human owners still need to maintain the record of processing, lawful bases, data-subject request process, processor agreements, transfer safeguards, incident contacts, risk acceptance, and independent assurance evidence.
