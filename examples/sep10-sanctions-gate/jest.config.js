module.exports = {
  ...require('../../jest.base.js'),
  displayName: 'sep10-sanctions-gate',
  testMatch: ['**/test/**/*.test.ts'],
  transformIgnorePatterns: ['/node_modules/(?!(@noble|uint8array-extras)/)'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
    '^.+\\.jsx?$': 'babel-jest',
  },
};
