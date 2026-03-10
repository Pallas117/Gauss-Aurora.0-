# Xcode optimization runbook

After installing a new Xcode update, use this runbook to keep the Manus mobile E2E (Detox) and iOS build path working correctly.

## Recommended Xcode version

Use **Xcode 16.x** (or latest stable). Release notes: [Xcode 16 Release Notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-16-release-notes).

## After installing a new Xcode update

1. **Select command-line tools**
   ```bash
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   ```
   If you use a versioned app (e.g. Xcode_16.2.app), use that path instead.

2. **Open Xcode once** to accept the license and install any required components.

3. **For Manus (when `mobile/manus` exists):** in `mobile/manus/ios` run:
   ```bash
   cd mobile/manus/ios && pod install
   ```
   (CocoaPods is used by typical React Native iOS projects.)

4. **Rebuild** the app using the Detox build command (from [.detoxrc.js](../.detoxrc.js)):
   ```bash
   npx detox build -c ios.sim.debug
   ```
   Or run the full build manually:
   ```bash
   cd mobile/manus/ios && xcodebuild -workspace Manus.xcworkspace -scheme Manus -configuration Debug -sdk iphonesimulator -derivedDataPath build
   ```

5. **If builds fail:** clean DerivedData for the project:
   ```bash
   rm -rf ~/Library/Developer/Xcode/DerivedData/*Manus*
   ```
   Then run the build again.

## Simulator

The first simulator launch after an Xcode update can be slow (GateKeeper / dyld cache scan). You can override the Detox simulator device via env so it matches your Xcode’s runtimes:

```bash
export DETOX_DEVICE_TYPE=iPhone 16
npx detox test -c ios.sim.debug --headless
```

See [.detoxrc.js](../.detoxrc.js) for the default device type (e.g. iPhone 15).

## Local Detox

From repo root:

```bash
npx detox test -c ios.sim.debug --headless
```

See [mobile/README.md](../mobile/README.md) for required test IDs and app location.

## Verify Xcode environment

Run the Xcode check script to print the active Xcode version and path:

```bash
./scripts/xcode-check.sh
```

Optional: use it in CI or locally to require a minimum Xcode version (e.g. 16.0).
