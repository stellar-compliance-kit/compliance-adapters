import { execFileSync } from 'child_process';
import * as path from 'path';

const CLI = path.resolve(__dirname, '..', 'bin', 'compliance-adapters.js');

function run(args: string[]): string {
  return execFileSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
  });
}

function runWithError(args: string[]): { stdout: string; stderr: string; code: number | null } {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout: string; stderr: string; status: number | null };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.status };
  }
}

describe('compliance-adapters CLI', () => {
  it('prints top-level usage with --help', () => {
    const output = run(['--help']);
    expect(output).toContain('Usage: compliance-adapters <command>');
    expect(output).toContain('sync-sanctions');
  });

  it('prints top-level usage with -h', () => {
    const output = run(['-h']);
    expect(output).toContain('Usage: compliance-adapters <command>');
  });

  it('prints top-level usage with no arguments', () => {
    const output = run([]);
    expect(output).toContain('Usage: compliance-adapters <command>');
  });

  it('prints sync-sanctions help with --help flag', () => {
    const output = run(['sync-sanctions', '--help']);
    expect(output).toContain('Usage: compliance-adapters sync-sanctions');
    expect(output).toContain('--addresses');
    expect(output).toContain('--dry-run');
    expect(output).toContain('--contract-id');
    expect(output).toContain('--rpc-url');
    expect(output).toContain('--network-passphrase');
    expect(output).toContain('--secret-key');
  });

  it('exits with code 1 for unknown commands', () => {
    const { stderr, code } = runWithError(['unknown-command']);
    expect(code).toBe(1);
    expect(stderr).toContain('Unknown command');
  });

  it('runs sync-sanctions --dry-run with a valid addresses file', () => {
    const fixturesPath = path.resolve(
      __dirname,
      '..',
      'sanctions-oracle',
      'test',
      'fixtures',
      'addresses.json',
    );
    const output = run(['sync-sanctions', '--addresses', fixturesPath, '--dry-run']);

    // Output contains [dry-run] log lines followed by JSON result
    expect(output).toContain('[dry-run]');
    // Extract JSON block from the output (starts at first '{', ends at last '}')
    const jsonStart = output.indexOf('{');
    const jsonEnd = output.lastIndexOf('}');
    const result = JSON.parse(output.slice(jsonStart, jsonEnd + 1));
    expect(result.dryRun).toBe(true);
    expect(result.checked).toBeGreaterThan(0);
    expect(result.flagged.length).toBeGreaterThan(0);
    expect(result.written).toEqual([]);
  });

  it('exits with code 1 when --addresses is missing', () => {
    const { stderr, code } = runWithError(['sync-sanctions']);
    expect(code).toBe(1);
    expect(stderr).toContain('--addresses');
  });
});
