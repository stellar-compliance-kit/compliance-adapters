'use strict';
// Minimal stub — real implementation is not required for server.test.js
function MockSanctionsProvider() {}
MockSanctionsProvider.prototype.checkAddress = async () => ({ flagged: false });

module.exports = {
  MockSanctionsProvider,
  syncSanctionsToDenylist: async () => ({ synced: [], skipped: [] }),
};
