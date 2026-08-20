# Containerized test environment

Project Gauss now has a disposable test/build boundary in
`docker-compose.test.yml`. It is intentionally separate from the existing
BXR/infrastructure stack in `docker-compose.yml`.

## What it protects

The test image excludes `.env`, Supabase keys, Tailscale state, host sockets,
Git metadata, and host directories. The test runner uses `network_mode: none`,
a read-only filesystem, and temporary filesystems for build/test output. The
optional backend smoke service is reachable only on `127.0.0.1:13001` and uses
an internal Docker network with no external egress. The test runner is capped
at 2 GiB/2 CPUs and the smoke backend at 768 MiB/1 CPU.

The container does not disable production security controls. It supplies
explicit test-only settings: no Supabase persistence, suspended ingestion,
disabled autoscaling/radiation schedulers, and no Turing network inventory.
Production secrets and PQC/Tailscale boundaries are therefore not represented
as “passed” by a local container run; they remain separate integration gates.

## Commands

```sh
npm run container:test:check
npm run container:test:build
npm run container:test
npm run container:test:up
npm run container:test:smoke
npm run container:test:down
```

The launcher fails clearly when Docker or Compose is unavailable. On Judith,
Docker is currently not installed, so container execution is an environment
blocker rather than evidence of a failing application test. The regular local
Node/Python/Rust checks remain authoritative until a container engine is
installed.

## Boundaries

- The image build needs registry access to download the Node base image and npm
  dependencies; runtime tests have no network access unless the operator
  explicitly changes the Compose file.
- No real Supabase key should be added to this Compose file. Use a separate,
  authenticated integration environment for RLS and staff-login tests.
- No Tailscale/WireGuard interface, Docker socket, privileged mode, host PID
  namespace, or host filesystem mount is permitted by default.
- The backend smoke service is a localhost development check, not a production
  deployment or a replacement for Talos/Tailscale verification.
