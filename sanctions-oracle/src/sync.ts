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

  const uniqueAddresses = Array.from(new Set(addresses));
  const flagged: string[] = [];
  for (const address of uniqueAddresses) {
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
    checked: uniqueAddresses.length,
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

export interface CliArgs {
  addressesPath?: string;
  dryRun: boolean;
  contractId?: string;
  rpcUrl?: string;
  networkPassphrase?: string;
  secretKey?: string;
  help?: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
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
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        break;
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`
sanctions-oracle sync - Synchronize sanctions data to a Soroban denylist

USAGE:
  sanctions-oracle sync [OPTIONS]

OPTIONS:
  --addresses <path>          Path to JSON file containing array of addresses to check
  --contract-id <id>          Soroban contract ID (required for live sync)
  --rpc-url <url>             Soroban RPC endpoint URL (required for live sync)
  --network-passphrase <str>  Network passphrase (required for live sync)
  --secret-key <key>          Source account secret key (required for live sync)
  --dry-run                   Preview output without writing to the contract
  --help, -h                  Show this help message

EXAMPLES:
  # Dry-run mode: check addresses without writing
  sanctions-oracle sync --addresses addresses.json --dry-run

  # Live mode: sync flagged addresses to contract
  sanctions-oracle sync \\
    --addresses addresses.json \\
    --contract-id CXXXX \\
    --rpc-url https://soroban-testnet.stellar.org \\
    --network-passphrase "Test SDF Network ; September 2015" \\
    --secret-key SBXXXX
  `);
}

export async function runCli(argv?: string[]): Promise<void> {
  const processArgv = argv ?? process.argv.slice(2);
  const args = parseArgs(processArgv);

  if (args.help) {
    printHelp();
    return;
  }

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
