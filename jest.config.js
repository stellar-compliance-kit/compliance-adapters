/**
 * Root Jest config: runs every package suite as a Jest project so `npm test`
 * gives a single run with a combined coverage report. Per-package
 * `npm test --workspace=<pkg>` still uses each package's own jest.config.js.
 * e2e-tests is excluded (needs Docker); run it with `npm run test:e2e`.
 */
const packages = [
  'backoff',
  'logger',
  'shared',
  'tracing-types',
  'metrics',
  'sep10-auth',
  'sanctions-oracle',
  'horizon-listener',
  'examples/full-stack-demo',
  'examples/sep10-sanctions-gate',
];

module.exports = {
  projects: [
    ...packages.map((p) => `<rootDir>/${p}`),
    {
      displayName: 'cli',
      rootDir: __dirname,
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/test/cli.spec.ts', '<rootDir>/test/changelog-check.test.ts'],
      transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.base.json' }],
      },
    },
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text-summary', 'lcov', 'json-summary'],
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/*.test.ts', '**/test/*.spec.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.base.json' }],
  },
};
