/** @type {import('jest').Config} */
module.exports = {
  displayName: 'full-stack-demo',
  testEnvironment: 'node',
  testMatch: ['**/*.test.js'],
  // Note: these tests intentionally exercise the real built workspace packages
  // (server.js requires ../../<pkg>/dist/index.js), so build them first.
  transformIgnorePatterns: ['/node_modules/(?!(@noble|uint8array-extras)/)'],
  transform: {
    '^.+\\.js$': 'babel-jest',
  },
};
