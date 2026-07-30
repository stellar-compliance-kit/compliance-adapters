/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import * as fs from 'fs';
import {
  Contract,
  Keypair,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk';
import { SanctionsProvider } from './SanctionsProvider';
import { MockSanctionsProvider } from './mockProvider';

export interface DenylistWriter {
  addToDenylist(address: string): Promise<{ hash: string }>;
}

export interface SyncOptions {
  provider: SanctionsProvider;
  /**
   * Candidate addresses to check. In a real deployment this might come
   * from a chain scan or an existing account list; here it's just an
   * injected array so this function stays pure and easily testable
   * without a network dependency.
   */
  addresses: string[];
  writer: DenylistWriter;
  dryRun?: boolean;
}

export interface SyncResult {
  checked: number;
  flagged: string[];
  written: string[];
  dryRun: boolean;
}

export async function syncSanctionsToDenylist(options: SyncOptions): Promise<SyncResult> {
  const { provider, addresses, writer, dryRun = false } = options;

  const flagged: string[] = [];
  for (const address of addresses) {
    const result = await provider.checkAddress(address);
    if (result.flagged) {
      flagged.push(address);
    }
  }

  const written: string[] = [];
  if (dryRun) {
    for (const address of flagged) {
      console.log(`[dry-run] would call add_to_denylist(${address})`);
    }
  } else {
    for (const address of flagged) {
      await writer.addToDenylist(address);
      written.push(address);
    }
  }

  return {
    checked: addresses.length,
    flagged,
    written,
    dryRun,
  };
}

export interface RpcDenylistWriterOptions {
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
  sourceKeypair: Keypair;
}

// Kept behind the DenylistWriter interface (rather than called directly
// from syncSanctionsToDenylist) so tests can inject a fake writer instead
// of touching a live RPC endpoint.
export function createRpcDenylistWriter(options: RpcDenylistWriterOptions): DenylistWriter {
  const { rpcUrl, networkPassphrase, contractId, sourceKeypair } = options;
  const server = new rpc.Server(rpcUrl);
  const contract = new Contract(contractId);

  return {
    async addToDenylist(address: string): Promise<{ hash: string }> {
      const account = await server.getAccount(sourceKeypair.publicKey());

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase,
      })
        .addOperation(contract.call('add_to_denylist', nativeToScVal(address, { type: 'address' })))
        .setTimeout(30)
        .build();

      const prepared = await server.prepareTransaction(tx);
      prepared.sign(sourceKeypair);

      const sendResult = await server.sendTransaction(prepared);
      return { hash: sendResult.hash };
    },
  };
}

interface CliArgs {
  addressesPath?: string;
  dryRun: boolean;
  contractId?: string;
  rpcUrl?: string;
  networkPassphrase?: string;
  secretKey?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--addresses':
        args.addressesPath = argv[++i];
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--contract-id':
        args.contractId = argv[++i];
        break;
      case '--rpc-url':
        args.rpcUrl = argv[++i];
        break;
      case '--network-passphrase':
        args.networkPassphrase = argv[++i];
        break;
      case '--secret-key':
        args.secretKey = argv[++i];
        break;
      default:
        break;
    }
  }
  return args;
}

async function runCli(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.addressesPath) {
    console.error('Missing required flag: --addresses <path-to-json-array>');
    process.exitCode = 1;
    return;
  }

  const addresses: string[] = JSON.parse(fs.readFileSync(args.addressesPath, 'utf8'));
  // CLI ships only the reference mock provider; wiring a real provider is
  // left to consumers embedding syncSanctionsToDenylist programmatically.
  const provider = new MockSanctionsProvider();

  if (args.dryRun) {
    const result = await syncSanctionsToDenylist({
      provider,
      addresses,
      writer: {
        async addToDenylist(): Promise<{ hash: string }> {
          throw new Error('addToDenylist should not be called in dry-run mode');
        },
      },
      dryRun: true,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!args.contractId || !args.rpcUrl || !args.networkPassphrase || !args.secretKey) {
    console.error(
      'Missing required flags for a live sync. Required: --contract-id, --rpc-url, --network-passphrase, --secret-key (or pass --dry-run).',
    );
    process.exitCode = 1;
    return;
  }

  const writer = createRpcDenylistWriter({
    rpcUrl: args.rpcUrl,
    networkPassphrase: args.networkPassphrase,
    contractId: args.contractId,
    sourceKeypair: Keypair.fromSecret(args.secretKey),
  });

  const result = await syncSanctionsToDenylist({ provider, addresses, writer, dryRun: false });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  runCli().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
