const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const PACKAGES = [
  'backoff',
  'logger',
  'shared',
  'tracing-types',
  'metrics',
  'tracing',
  'sep10-auth',
  'sanctions-oracle',
  'horizon-listener',
];

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    stdio: 'pipe',
    encoding: 'utf8',
    ...opts,
  });
}

function findPackageDir(name) {
  const candidates = [
    path.join(ROOT, 'packages', name),
    path.join(ROOT, name),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
  }
  throw new Error(`Could not locate package directory for "${name}"`);
}

function readPackageJson(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
}

function resolveEntryPoint(pkg) {
  if (typeof pkg.main === 'string' && pkg.main) {
    return pkg.main;
  }
  if (pkg.exports) {
    const exp = pkg.exports;
    if (typeof exp === 'string') return exp;
    if (typeof exp === 'object') {
      const root = exp['.'] !== undefined ? exp['.'] : exp;
      if (typeof root === 'string') return root;
      if (root && typeof root === 'object') {
        for (const key of ['require', 'import', 'default', 'node']) {
          if (typeof root[key] === 'string') return root[key];
        }
      }
    }
  }
  return 'index.js';
}

function packPackage(name) {
  const dir = findPackageDir(name);
  const pkg = readPackageJson(dir);
  log(`Packing ${pkg.name || name}...`);
  const output = run('npm', ['pack', '--json'], { cwd: dir });
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch (err) {
    throw new Error(`Failed to parse npm pack output for ${name}: ${err.message}`);
  }
  const info = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!info || !info.filename) {
    throw new Error(`npm pack did not report a filename for ${name}`);
  }
  const tarball = path.join(dir, info.filename);
  if (!fs.existsSync(tarball)) {
    throw new Error(`Tarball not found after pack for ${name}: ${tarball}`);
  }
  return { dir, pkg, tarball };
}

function smokeTest(name) {
  const { pkg, tarball } = packPackage(name);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `smoke-pack-${name}-`));
  try {
    run('npm', ['init', '-y'], { cwd: tmpDir });
    log(`Installing ${path.basename(tarball)} into temp project...`);
    run('npm', ['install', '--no-audit', '--no-fund', tarball], { cwd: tmpDir });

    const installedName = pkg.name || name;
    const entry = resolveEntryPoint(pkg);
    const installedDir = path.join(tmpDir, 'node_modules', installedName);
    if (!fs.existsSync(installedDir)) {
      throw new Error(`Package ${installedName} was not installed into node_modules`);
    }
    const entryPath = path.join(installedDir, entry);
    if (!fs.existsSync(entryPath)) {
      throw new Error(`Entry point missing after install: ${entry} (${entryPath})`);
    }

    log(`Importing ${installedName} (${entry})...`);
    const script = `
      (async () => {
        const target = ${JSON.stringify(installedName)};
        try {
          const mod = require(target);
          if (mod === undefined) {
            throw new Error('require returned undefined');
          }
        } catch (err) {
          if (err && err.code === 'ERR_REQUIRE_ESM') {
            await import(target);
          } else {
            throw err;
          }
        }
      })().catch((err) => {
        console.error(err && err.stack ? err.stack : err);
        process.exit(1);
      });
    `;
    run(process.execPath, ['-e', script], { cwd: tmpDir });
    log(`OK: ${installedName}`);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (err) {
      log(`Warning: failed to clean up ${tmpDir}: ${err.message}`);
    }
    try {
      fs.rmSync(tarball, { force: true });
    } catch (err) {
      log(`Warning: failed to remove tarball ${tarball}: ${err.message}`);
    }
  }
}

function main() {
  const failures = [];
  for (const name of PACKAGES) {
    try {
      smokeTest(name);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      log(`FAIL: ${name}: ${message}`);
      failures.push({ name, message });
    }
  }

  if (failures.length > 0) {
    log(`\n${failures.length} package(s) failed smoke test:`);
    for (const f of failures) {
      log(`  - ${f.name}: ${f.message}`);
    }
    process.exit(1);
  }

  log(`\nAll ${PACKAGES.length} packages passed smoke test.`);
}

main();