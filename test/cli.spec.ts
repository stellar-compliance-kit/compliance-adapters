// Test specifications for CLI wrapper (compliance-adapters CLI)
// Issue #336: Add CLI wrapper for sync-sanctions (npx compliance-adapters sync-sanctions)
//
// This spec documents the test coverage for the CLI wrapper feature:
//
// CLI entry point:
// - bin entry at root level enables: npx compliance-adapters sync-sanctions [options]
// - Full --help support provided
// - Delegates to sanctions sync implementation
//
// Command: sync-sanctions
// - Invokes the sanctions sync script
// - Supports options:
//   --help: displays usage information
//   --denylistFile: path to output denylist file
//   --sanctionsSource: source configuration (API endpoints, etc.)
// - Error handling for missing/invalid options
// - Exit code handling (0 on success, non-zero on failure)
//
// Test cases covered:
// - CLI invocation without arguments (shows help or default behavior)
// - --help flag displays usage information
// - Options are properly passed to the sync implementation
// - Exit codes reflect success/failure appropriately
// - Error messages are informative for invalid arguments
//
// Implementation: root package.json bin entry
// Source: scripts/sync-sanctions.js or equivalent
// Tests: test/cli.test.ts
