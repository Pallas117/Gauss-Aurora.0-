# Spacecraft Fleet Manifest Operations

The open TLE catalog can locate spacecraft, but it cannot prove that every operational system is present or correctly identified. To close that gap, an authenticated mission operator can submit an expected-fleet manifest through `POST /api/ssa/system-profiles`.

Use [fleet-manifest.template.json](/Users/josh/Documents/Documents/lightbound/Gauss/Gauss%20AI/Gauss%20Aurora/research/space-environment/fleet-manifest.template.json) as the packet shape. The request body is:

```json
{
  "profiles": [
    {
      "systemId": "example-constellation",
      "namePatterns": ["EXAMPLE"],
      "missionType": "communications_leo",
      "operator": "authoritative operator",
      "expectedNoradIds": ["12345", "12346"],
      "expectedObjectCount": 2,
      "observedAt": "2026-07-17T00:00:00Z",
      "source": "operator fleet registry",
      "provenanceUrls": ["https://operator.example/fleet-record"]
    }
  ]
}
```

Submit it only with an operator/mission bearer token:

```sh
curl -sS "$GAUSS_BASE_URL/api/ssa/system-profiles" \
  -H "Authorization: Bearer $GAUSS_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @research/space-environment/fleet-manifest.template.json
```

The manifest is bounded to 100 profiles per request and 5,000 explicit NORAD IDs per profile. `expectedNoradIds` is the preferred form because it produces actionable missing-object IDs. `expectedObjectCount` may be used when the authoritative registry cannot disclose identifiers, but it can only report counts and ratios.

After submission, query `GET /api/ssa/exposure-screening`. The `readiness.globalFleetCoverage` gate becomes true only when the catalog is fresh, complete, untruncated, free of source failures and identity gaps, and every expected manifest has zero missing objects. This gate means inventory reconciliation is complete; it does not mean the spacecraft are healthy or immune to radiation/electromagnetic effects.

Do not use a TLE name, an inferred operator, or a public catalog count as a substitute for an authoritative manifest. Health, shielding, radiation qualification, dose limits, and confirmed damage remain separate protected evidence inputs.
