module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts'],
  // Point the shared logger package at its TypeScript source so ts-jest can
  // compile it directly without requiring a separate build step.
  moduleNameMapper: {
    '^@compliance-adapters/logger$': '<rootDir>/../logger/src/index.ts',
  },
};
