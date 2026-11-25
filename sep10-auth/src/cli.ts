import { buildChallenge } from './challenge';
import { signJwt, decodeJwt, verifyJwt } from './jwt';
import { verifyChallenge } from './verify';
import { Sep10Error } from './errors';

export interface CliIO {
  stdout: (msg: string) => void;
  stderr: (msg: string) => void;
}

const defaultIO: CliIO = {
  stdout: (msg: string) => process.stdout.write(msg + '\n'),
  stderr: (msg: string) => process.stderr.write(msg + '\n'),
};

export interface RunCliOptions {
  io?: CliIO;
  env?: NodeJS.ProcessEnv;
}

interface ParsedArgs {
  command: string | undefined;
  subcommand: string | undefined;
  flags: Record<string, string | boolean>;
  positionals: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const withoutPrefix = arg.slice(2);
      const eqIndex = withoutPrefix.indexOf('=');
      if (eqIndex !== -1) {
        const key = withoutPrefix.slice(0, eqIndex);
        const value = withoutPrefix.slice(eqIndex + 1);
        flags[key] = value;
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[withoutPrefix] = next;
          i++;
        } else {
          flags[withoutPrefix] = true;
        }
      }
    } else {
      positionals.push(arg);
    }
  }

  return {
    command: positionals[0],
    subcommand: positionals[1],
    flags,
    positionals: positionals.slice(2),
  };
}

function getStringFlag(
  flags: Record<string, string | boolean>,
  name: string,
): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

function getBooleanFlag(
  flags: Record<string, string | boolean>,
  name: string,
): boolean {
  return flags[name] === true || flags[name] === 'true';
}

const USAGE = `sep10-auth development CLI

Usage:
  sep10-auth token issue --secret <S...> --home-domain <domain> [options]
  sep10-auth token inspect --token <jwt> [options]

Commands:
  token issue     Build a SEP-10 challenge, sign it with a dev keypair, and print the JWT.
  token inspect   Decode and verify a provided token, printing header/claims/validity.

Options for "token issue":
  --secret <S...>            Stellar secret key of the signing (server) account (required)
  --home-domain <domain>     Home domain to include in the challenge (required)
  --client-account <G...>    Client account public key (defaults to the signing account)
  --web-auth-domain <domain> Web auth domain (defaults to home domain)
  --network-passphrase <p>   Network passphrase (defaults to testnet)
  --timeout <seconds>        Challenge timeout in seconds (defaults to 300)

Options for "token inspect":
  --token <jwt>              The JWT to inspect (required)
  --secret <S...>            Secret key used to verify the signature (optional)
  --public-key <G...>        Public key used to verify the signature (optional)

Global options:
  --allow-insecure-dev       Allow running when NODE_ENV=production
  --help                     Show this help message

This CLI is intended for local development only.
`;

function printHelp(io: CliIO): void {
  io.stdout(USAGE);
}

function formatError(err: unknown): string {
  if (err instanceof Sep10Error) {
    return `Error: ${err.message}`;
  }
  if (err instanceof Error) {
    return `Error: ${err.message}`;
  }
  return `Error: ${String(err)}`;
}

async function handleTokenIssue(
  parsed: ParsedArgs,
  io: CliIO,
): Promise<number> {
  const secret = getStringFlag(parsed.flags, 'secret');
  const homeDomain = getStringFlag(parsed.flags, 'home-domain');

  if (!secret) {
    io.stderr('Error: --secret is required for "token issue"');
    return 1;
  }
  if (!homeDomain) {
    io.stderr('Error: --home-domain is required for "token issue"');
    return 1;
  }

  const clientAccount = getStringFlag(parsed.flags, 'client-account');
  const webAuthDomain = getStringFlag(parsed.flags, 'web-auth-domain');
  const networkPassphrase = getStringFlag(parsed.flags, 'network-passphrase');
  const timeoutRaw = getStringFlag(parsed.flags, 'timeout');

  let timeout: number | undefined;
  if (timeoutRaw !== undefined) {
    const parsedTimeout = Number(timeoutRaw);
    if (!Number.isFinite(parsedTimeout) || parsedTimeout <= 0) {
      io.stderr('Error: --timeout must be a positive number of seconds');
      return 1;
    }
    timeout = parsedTimeout;
  }

  try {
    const challenge = await buildChallenge({
      serverSecret: secret,
      homeDomain,
      clientAccount,
      webAuthDomain,
      networkPassphrase,
      timeout,
    });

    const token = await signJwt({
      challenge,
      serverSecret: secret,
      networkPassphrase,
    });

    io.stdout(token);
    return 0;
  } catch (err) {
    io.stderr(formatError(err));
    return 1;
  }
}

async function handleTokenInspect(
  parsed: ParsedArgs,
  io: CliIO,
): Promise<number> {
  const token = getStringFlag(parsed.flags, 'token');
  if (!token) {
    io.stderr('Error: --token is required for "token inspect"');
    return 1;
  }

  const secret = getStringFlag(parsed.flags, 'secret');
  const publicKey = getStringFlag(parsed.flags, 'public-key');

  try {
    const decoded = decodeJwt(token);

    io.stdout('Header:');
    io.stdout(JSON.stringify(decoded.header, null, 2));
    io.stdout('');
    io.stdout('Claims:');
    io.stdout(JSON.stringify(decoded.payload, null, 2));
    io.stdout('');

    const now = Math.floor(Date.now() / 1000);
    const exp = typeof decoded.payload.exp === 'number' ? decoded.payload.exp : undefined;
    const iat = typeof decoded.payload.iat === 'number' ? decoded.payload.iat : undefined;

    io.stdout('Validity:');
    if (iat !== undefined) {
      io.stdout(`  issued at: ${new Date(iat * 1000).toISOString()}`);
    }
    if (exp !== undefined) {
      io.stdout(`  expires at: ${new Date(exp * 1000).toISOString()}`);
      if (exp < now) {
        io.stdout('  status: EXPIRED');
      } else {
        io.stdout(`  status: valid (expires in ${exp - now}s)`);
      }
    } else {
      io.stdout('  status: no expiry claim present');
    }
    io.stdout('');

    if (secret || publicKey) {
      const verification = await verifyJwt({
        token,
        serverSecret: secret,
        publicKey,
      });

      if (verification.valid) {
        io.stdout('Signature: VALID');
      } else {
        io.stdout(`Signature: INVALID (${verification.reason ?? 'unknown reason'})`);
        return 1;
      }
    } else {
      io.stdout('Signature: not verified (provide --secret or --public-key to verify)');
    }

    return 0;
  } catch (err) {
    io.stderr(formatError(err));
    return 1;
  }
}

async function handleToken(
  parsed: ParsedArgs,
  io: CliIO,
): Promise<number> {
  switch (parsed.subcommand) {
    case 'issue':
      return handleTokenIssue(parsed, io);
    case 'inspect':
      return handleTokenInspect(parsed, io);
    case undefined:
      io.stderr('Error: missing "token" subcommand (expected "issue" or "inspect")');
      return 1;
    default:
      io.stderr(`Error: unknown "token" subcommand: ${parsed.subcommand}`);
      return 1;
  }
}

export async function runCli(
  argv: string[],
  options: RunCliOptions = {},
): Promise<number> {
  const io = options.io ?? defaultIO;
  const env = options.env ?? process.env;

  const parsed = parseArgs(argv);

  if (getBooleanFlag(parsed.flags, 'help') || parsed.command === undefined) {
    printHelp(io);
    return parsed.command === undefined && !getBooleanFlag(parsed.flags, 'help') ? 1 : 0;
  }

  const allowInsecureDev = getBooleanFlag(parsed.flags, 'allow-insecure-dev');
  if (env.NODE_ENV === 'production' && !allowInsecureDev) {
    io.stderr(
      'Error: refusing to run in production. This CLI is for local development only. ' +
        'Pass --allow-insecure-dev to override.',
    );
    return 1;
  }

  try {
    switch (parsed.command) {
      case 'token':
        return await handleToken(parsed, io);
      default:
        io.stderr(`Error: unknown command: ${parsed.command}`);
        io.stderr('');
        printHelp(io);
        return 1;
    }
  } catch (err) {
    io.stderr(formatError(err));
    return 1;
  }
}

// Allow direct execution: `node cli.js ...` or `ts-node cli.ts ...`
if (require.main === module) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(formatError(err) + '\n');
      process.exitCode = 1;
    });
}