/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

// Per-package bundle size budgets (gzipped, bundled with esbuild for Node).
// `npm run size` fails if any package exceeds its budget. The Stellar SDK is a
// legitimate dependency of shared and the adapter packages, so it is excluded
// from their budgets; the remaining utility packages must never pull it in.
const node = (config) => ({ ...config, platform: 'node' });
const sdk = ['@stellar/stellar-sdk'];

module.exports = [
  { name: '@compliance-adapters/backoff', path: 'backoff/dist/index.js', limit: '1 kB' },
  { name: '@compliance-adapters/logger', path: 'logger/dist/index.js', limit: '1 kB' },
  { name: '@compliance-adapters/shared', path: 'shared/dist/index.js', limit: '2 kB', ignore: sdk },
  { name: '@compliance-adapters/metrics', path: 'metrics/dist/index.js', limit: '1.5 kB' },
  { name: '@compliance-adapters/tracing', path: 'tracing/dist/index.js', limit: '1.5 kB' },
  { name: 'sep10-auth', path: 'sep10-auth/dist/index.js', limit: '15 kB', ignore: sdk },
  { name: 'sanctions-oracle', path: 'sanctions-oracle/dist/index.js', limit: '14 kB', ignore: sdk },
  { name: 'horizon-listener', path: 'horizon-listener/dist/index.js', limit: '8 kB', ignore: sdk },
].map((entry) => ({ ...entry, modifyEsbuildConfig: node }));
