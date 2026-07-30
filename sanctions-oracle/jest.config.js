module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts'],
  coverageReporters: ['text', 'lcov', 'json-summary'],
  // @stellar/stellar-sdk depends on @noble/hashes and @noble/ed25519 versions
  // that ship ESM-only builds; transpile just those through Babel instead of
  // downgrading/overriding the dependency versions stellar-sdk actually needs.
  transformIgnorePatterns: ['/node_modules/(?!(@noble|uint8array-extras)/)'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
    '^.+\\.jsx?$': 'babel-jest',
  },
};
