'use strict';
// Minimal stub — real implementation is not required for server.test.js
module.exports = {
  Keypair: {
    fromSecret: () => ({ publicKey: () => 'GSERVER_STUB_PUBLIC_KEY_000000000000000000000000000000000' }),
    random: () => ({
      publicKey: () => 'GCLIENT_STUB_PUBLIC_KEY_000000000000000000000000000000000',
      secret: () => 'SCLIENT_STUB_SECRET_KEY_0000000000000000000000000000000000',
    }),
  },
  Networks: { TESTNET: 'Test SDF Network ; September 2015' },
};
