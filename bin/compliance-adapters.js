#!/usr/bin/env node

'use strict';

const COMMANDS = {
  'sync-sanctions': {
    description: 'Sync flagged addresses into a denylist-gate contract',
    flags: [
      ['--addresses <path>', 'Path to JSON array of candidate addresses (required)'],
      ['--dry-run', 'Log what would happen without submitting transactions'],
      ['--contract-id <id>', 'Soroban contract ID (required for live sync)'],
      ['--rpc-url <url>', 'Soroban RPC endpoint (required for live sync)'],
      ['--network-passphrase <passphrase>', 'Stellar network passphrase (required for live sync)'],
      ['--secret-key <key>', 'Signing secret key (required for live sync)'],
    ],
  },
};

function printUsage() {
  console.log('Usage: compliance-adapters <command> [options]\n');
  console.log('Commands:');
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    console.log(`  ${name}    ${cmd.description}`);
  }
  console.log('\nRun compliance-adapters <command> --help for command-specific options.');
}

function printCommandHelp(name, cmd) {
  console.log(`Usage: compliance-adapters ${name} [options]\n`);
  console.log(`${cmd.description}\n`);
  console.log('Options:');
  for (const [flag, desc] of cmd.flags) {
    console.log(`  ${flag.padEnd(40)} ${desc}`);
  }
}

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '--help' || command === '-h') {
  printUsage();
  process.exit(0);
}

const cmdDef = COMMANDS[command];
if (!cmdDef) {
  console.error(`Unknown command: ${command}\n`);
  printUsage();
  process.exit(1);
}

const commandArgs = args.slice(1);

if (commandArgs.includes('--help') || commandArgs.includes('-h')) {
  printCommandHelp(command, cmdDef);
  process.exit(0);
}

if (command === 'sync-sanctions') {
  // Rewrite process.argv so the sync script's parseArgs sees the right flags.
  process.argv = [process.argv[0], process.argv[1], ...commandArgs];
  const { runCli } = require('../sanctions-oracle/dist/sync.js');
  runCli().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
