/**
 * Detox config scaffold for Manus mobile e2e.
 *
 * This config is intentionally additive and only used when a React Native
 * app exists in /mobile/manus and CI job is enabled.
 *
 * Build command is compatible with Xcode 16; ensure xcode-select points at
 * the desired Xcode (e.g. sudo xcode-select -s /Applications/Xcode.app/Contents/Developer).
 * Simulator device can be overridden via DETOX_DEVICE_TYPE (e.g. iPhone 16).
 */
const deviceType = process.env.DETOX_DEVICE_TYPE || 'iPhone 15';

module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: 'tests/mobile/jest.config.js',
    },
    jest: {
      setupTimeout: 120000,
    },
  },
  apps: {
    'ios.debug': {
      type: 'ios.app',
      binaryPath: 'mobile/manus/ios/build/Build/Products/Debug-iphonesimulator/Manus.app',
      build:
        'cd mobile/manus/ios && xcodebuild -workspace Manus.xcworkspace -scheme Manus -configuration Debug -sdk iphonesimulator -derivedDataPath build',
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: {
        type: deviceType,
      },
    },
  },
  configurations: {
    'ios.sim.debug': {
      device: 'simulator',
      app: 'ios.debug',
    },
  },
};
