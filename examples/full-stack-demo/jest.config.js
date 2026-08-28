/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/*.test.js'],
  // Redirect unbuilt workspace packages and their heavy transitive deps to
  // lightweight stubs so the test suite runs without needing a full build.
  moduleNameMapper: {
    '^sep10-auth$': '<rootDir>/__mocks__/sep10-auth.js',
    '^horizon-listener$': '<rootDir>/__mocks__/horizon-listener.js',
    '^sanctions-oracle$': '<rootDir>/__mocks__/sanctions-oracle.js',
    '^@stellar/stellar-sdk$': '<rootDir>/__mocks__/@stellar/stellar-sdk.js',
  },
};
