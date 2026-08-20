# Kali network-only backend profile

The hardened Kali backend profile keeps sensitive processing and persistence off Judith. Set `GAUSS_SENSITIVE_DATA_MODE=network_only` only when the network-processing endpoint and sensitive store are HTTPS endpoints with an approved PQC gateway profile.

Required evidence before startup:

- `GAUSS_NETWORK_PROCESSING_URL` and `GAUSS_SENSITIVE_STORE_URL` are HTTPS.
- `GAUSS_SENSITIVE_STORE_PQC_REQUIRED=true` and `GAUSS_SENSITIVE_STORE_PQC_PROFILE` is set.
- `STAFF_AUTH_PQC_GATEWAY_REQUIRED=true` and `STAFF_AUTH_CRYPTO_PROFILE` is set.
- `GAUSS_PROCESSING_ALLOW_LOCAL_FALLBACK=false`.
- `GAUSS_LOCAL_SENSITIVE_WRITES=false`.

The backend fails closed when any requirement is missing. `GET /api/ops/processing/status` exposes only redacted policy state; secrets and endpoint values are never returned. Local development remains supported with the default `local` mode.
