/**
 * Shared Jest base config. Each workspace's jest.config.js spreads this and
 * adds package-specific options, so common settings live in one place.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts'],
  coverageReporters: ['text', 'lcov', 'json-summary'],
};
