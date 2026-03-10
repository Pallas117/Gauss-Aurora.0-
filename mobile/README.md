# Mobile E2E (Detox)

This repository includes Detox scaffolding for the React Native Manus app.

## Expected App Location

- `mobile/manus`

## Required Test IDs

- `app-root`
- `nav-heliophysics`
- `ar-scene`
- `threat-card-top`

## Run Locally (macOS)

```bash
npm ci
npx detox test -c ios.sim.debug --headless
```

CI runs this job only when `mobile/manus/package.json` exists.

After an Xcode update, see [docs/XCODE_OPTIMIZATION.md](../docs/XCODE_OPTIMIZATION.md) for build and simulator optimisation steps.
