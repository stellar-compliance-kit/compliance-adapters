module.exports = {
  ...require('../jest.base.js'),
  displayName: 'tracing-types',
  testMatch: ['**/test/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts'],
  coverageReporters: ['text', 'lcov', 'json-summary'],
};
