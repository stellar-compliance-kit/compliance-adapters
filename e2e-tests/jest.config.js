module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts'],
  // @stellar/stellar-sdk depends on @noble/hashes and @noble/ed25519 versions
  // that ship ESM-only builds; transpile just those through Babel instead of
  // downgrading/overriding the dependency versions stellar-sdk actually needs.
  transformIgnorePatterns: ['/node_modules/(?!(@noble|uint8array-extras)/)'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
    '^.+\\.jsx?$': 'babel-jest',
  },
  // Point sibling workspace packages at their TypeScript source so ts-jest
  // can compile them directly without requiring a separate build step first.
  moduleNameMapper: {
    '^@compliance-adapters/logger$': '<rootDir>/../logger/src/index.ts',
    '^sanctions-oracle$': '<rootDir>/../sanctions-oracle/src/index.ts',
    '^horizon-listener$': '<rootDir>/../horizon-listener/src/index.ts',
  },
  globals: {
    'ts-jest': {
      tsconfig: {
        esModuleInterop: true,
      },
    },
  },
  // Run tests sequentially to avoid port conflicts
  maxWorkers: 1,
  // Increase timeout for real ledger operations
  testTimeout: 60000,
  // Verbose output for debugging
  verbose: true,
  // Collect coverage separately (optional)
  collectCoverageFrom: ['test/**/*.ts'],
};
