"use strict";
/**
 * Detox config scaffold for Manus mobile e2e.
 *
 * This config is intentionally additive and only used when a React Native
 * app exists in /mobile/manus and CI job is enabled.
 *
 * Build command is compatible with recent Xcode versions; ensure xcode-select points at
 * the desired Xcode (e.g. sudo xcode-select -s /Applications/Xcode.app/Contents/Developer).
 * Simulator device can be overridden via DETOX_DEVICE_TYPE (e.g. iPhone 16).
 *
 * Environment overrides:
 * - DETOX_DEVICE_TYPE           (default: 'iPhone 15')
 * - DETOX_IOS_WORKSPACE         (default: 'Manus.xcworkspace')
 * - DETOX_IOS_SCHEME            (default: 'Manus')
 * - DETOX_IOS_CONFIGURATION     (default: 'Debug')
 * - DETOX_CONFIGURATION         (fallback for configuration)
 * - DETOX_IOS_APP_NAME          (default: 'Manus')
 * - DETOX_DERIVED_DATA          (default: mobile/manus/ios/build)
 * - DETOX_ARTIFACTS             (set to '1' to enable artifacts collection)
 */
const fs = require('fs');
const path = require('path');

const deviceType = process.env.DETOX_DEVICE_TYPE || 'iPhone 15';
const workspace = process.env.DETOX_IOS_WORKSPACE || 'Manus.xcworkspace';
const scheme = process.env.DETOX_IOS_SCHEME || 'Manus';
const configuration = process.env.DETOX_IOS_CONFIGURATION || process.env.DETOX_CONFIGURATION || 'Debug';
const appName = process.env.DETOX_IOS_APP_NAME || 'Manus';

const iosRoot = path.join('mobile', 'manus', 'ios');
const derivedData = process.env.DETOX_DERIVED_DATA || path.join(iosRoot, 'build');
const productsDirName = `${configuration}-iphonesimulator`;
const binaryPath = path.join(derivedData, 'Build', 'Products', productsDirName, `${appName}.app`);
const hasMobileWorkspace = fs.existsSync(path.join(iosRoot, workspace));

const base = {
  testRunner: {
    args: {
      $0: 'jest',
      config: 'tests/mobile/jest.config.js',
    },
    jest: {
      setupTimeout: 120000,
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: { type: deviceType },
    },
  },
  // Disable heavy artifacts by default to speed up local/CI runs.
  // Set DETOX_ARTIFACTS=1 to enable all default plugins.
  artifacts: process.env.DETOX_ARTIFACTS === '1'
    ? {}
    : {
        plugins: {
          log: 'none',
          video: 'none',
          instruments: 'none',
          uiHierarchy: 'disabled',
        },
      },
};
const apps = hasMobileWorkspace
  ? {
      'ios.debug': {
        type: 'ios.app',
        binaryPath,
        build: [
          `cd "${iosRoot}"`,
          [
            'xcodebuild',
            `-workspace "${workspace}"`,
            `-scheme "${scheme}"`,
            `-configuration "${configuration}"`,
            '-sdk iphonesimulator',
            `-derivedDataPath "${derivedData}"`,
            '-quiet',
            // Speed-ups that are safe for simulator builds
            'ONLY_ACTIVE_ARCH=YES',
            '-skipMacroValidation',
            '-skipPackagePluginValidation',
          ].join(' '),
        ].join(' && '),
      },
    }
  : {};

const configurations = hasMobileWorkspace
  ? {
      'ios.sim.debug': {
        device: 'simulator',
        app: 'ios.debug',
      },
    }
  : {};

module.exports = {
  ...base,
  apps,
  configurations,
};

