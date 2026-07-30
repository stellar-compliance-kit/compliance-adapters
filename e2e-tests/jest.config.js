module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts'],
  globals: {
    'ts-jest': {
      tsconfig: {
        esModuleInterop: true,
      },
    },
  },
  // Run tests sequentially to avoid port conflicts
  maxWorkers: 1,
  // Increase timeout for real ledger operations
  testTimeout: 60000,
  // Verbose output for debugging
  verbose: true,
  // Collect coverage separately (optional)
  collectCoverageFrom: ['test/**/*.ts'],
};
