module.exports = {
  ...require('../jest.base.js'),
  displayName: 'shared',
  testMatch: ['**/test/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts'],
  coverageReporters: ['text', 'lcov', 'json-summary'],
};
