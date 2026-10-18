/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "jsdom",
  // Every src test, matching tsconfig.test.json (src/lib tests such as mhd-fixture.test.ts were skipped before).
  testMatch: ["<rootDir>/src/**/*.test.ts?(x)"],
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        diagnostics: false,
        tsconfig: {
          isolatedModules: true,
          target: "ES2020",
          jsx: "react-jsx",
          module: "commonjs",
          moduleResolution: "node",
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          baseUrl: ".",
          paths: {
            "@/*": ["./src/*"],
          },
        },
      },
    ],
  },
  moduleNameMapper: {
    "^@/lib/api/base-url$": "<rootDir>/src/lib/api/__mocks__/base-url.ts",
    "^@/(.*)$": "<rootDir>/src/$1",
    "\\.(css|less|scss|sass)$": "identity-obj-proxy",
  },
  setupFiles: ["jest-canvas-mock", "<rootDir>/jest.setup.env.js"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  clearMocks: true,
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "/tests/e2e/"],
};
