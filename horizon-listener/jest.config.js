module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts'],
  transformIgnorePatterns: ['node_modules/(?!(@stellar|@noble)/)'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  // Point the shared logger package at its TypeScript source so ts-jest can
  // compile it directly without requiring a separate build step.
  moduleNameMapper: {
    '^@compliance-adapters/logger$': '<rootDir>/../logger/src/index.ts',
    '^@compliance-adapters/backoff$': '<rootDir>/../backoff/src/index.ts',
    '^@compliance-adapters/tracing$': '<rootDir>/../tracing/src/index.ts',
    '^@compliance-adapters/metrics$': '<rootDir>/../metrics/src/index.ts',
  },
  collectCoverageFrom: ['src/**/*.ts'],
  coverageReporters: ['text', 'lcov', 'json-summary'],
};
