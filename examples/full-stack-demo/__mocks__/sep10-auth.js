'use strict';
// Minimal stub — real implementation is not required for server.test.js
module.exports = {
  createSep10Middleware: () => (_req, _res, next) => next(),
  generateChallenge: () => ({
    transaction: 'stub-xdr',
    networkPassphrase: 'Test SDF Network ; September 2015',
  }),
};
