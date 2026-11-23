#!/usr/bin/env node
/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */
'use strict';

/**
 * Typechecks the TypeScript examples against the *published* package types.
 *
 * The examples normally resolve workspace sources, so a change that breaks the
 * built `.d.ts` of a package can go unnoticed. This script packs every library
 * workspace into a tarball, copies each TypeScript example into a temp
 * directory, installs the tarballs there (no workspace links), and runs `tsc`.
 *
 * Requires `npm run build` to have run first. Exits non-zero on any failure.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

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
const EXAMPLES = ['examples/sep10-sanctions-gate'];

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-packed-types-'));
const tarDir = path.join(tmp, 'tarballs');
fs.mkdirSync(tarDir);

// Pack each package and map its name to the tarball path.
const tarballs = {};
for (const pkg of PACKAGES) {
  const dir = path.join(ROOT, pkg);
  const { name } = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const [info] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', tarDir], dir));
  tarballs[name] = `file:${path.join(tarDir, info.filename)}`;
}

// Examples extend ../../tsconfig.base.json, so mirror that layout in tmp.
fs.copyFileSync(path.join(ROOT, 'tsconfig.base.json'), path.join(tmp, 'tsconfig.base.json'));

let failed = false;
for (const example of EXAMPLES) {
  const src = path.join(ROOT, example);
  const dest = path.join(tmp, example);
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (p) => !/[\\/](node_modules|dist|coverage)$/.test(p),
  });

  // Point every internal dependency at its tarball, and use overrides so the
  // transitive @compliance-adapters/* deps resolve to tarballs too.
  const pkgPath = path.join(dest, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  for (const field of ['dependencies', 'devDependencies']) {
    for (const dep of Object.keys(pkg[field] || {})) {
      if (tarballs[dep]) pkg[field][dep] = tarballs[dep];
    }
  }
  pkg.overrides = { ...(pkg.overrides || {}), ...tarballs };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

  console.log(`\n▶ ${example}: installing packed tarballs`);
  run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts'], dest);
  try {
    console.log(`▶ ${example}: tsc --noEmit`);
    execFileSync('npx', ['tsc', '-p', '.', '--noEmit'], { cwd: dest, stdio: 'inherit' });
    console.log(`✔ ${example}: published types OK`);
  } catch {
    console.error(`✖ ${example}: typecheck failed against published package types`);
    failed = true;
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
