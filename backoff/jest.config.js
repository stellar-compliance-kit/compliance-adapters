module.exports = {
  ...require('../jest.base.js'),
  displayName: 'backoff',
  testMatch: ['**/test/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts'],
  coverageReporters: ['text', 'lcov', 'json-summary'],
};
