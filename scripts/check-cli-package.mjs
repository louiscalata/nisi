// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
// Exercise the exact packed public package through its installed npm bin.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this check with `npm run check:cli-package`.');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-cli-package-'));
const packDir = path.join(tempRoot, 'pack');
const consumerDir = path.join(tempRoot, 'consumer');
fs.mkdirSync(packDir);
fs.mkdirSync(consumerDir);

function npm(args, cwd, label) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 90_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw new Error(`${label} could not run: ${result.error.message}`);
  if (result.status === null) throw new Error(`${label} timed out.`);
  return result;
}

function requireSuccess(result, label) {
  assert.equal(result.status, 0, `${label} failed: ${result.stderr || result.stdout}`);
}

try {
  const packResult = npm(['pack', '--json', '--pack-destination', packDir], root, 'npm pack');
  requireSuccess(packResult, 'npm pack');
  const packInfo = JSON.parse(packResult.stdout)[0];
  const archive = path.join(packDir, packInfo.filename);
  const packedPaths = new Set(packInfo.files.map(file => file.path));
  for (const required of [
    'bin/nisi.mjs',
    'examples/workflow.mjs',
    'examples/local-model-workflow.mjs',
    'LICENSE',
    'package.json',
  ]) assert(packedPaths.has(required), `Archive is missing ${required}.`);
  assert(![...packedPaths].some(file => /(^|\/)(tests?|work-orders|private|veritas)(\/|\.|$)/i.test(file)),
    'The public CLI archive contains a test, private, work-order, or Veritas path.');

  const install = npm([
    'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', archive,
  ], consumerDir, 'offline package install');
  requireSuccess(install, 'offline package install');

  function cli(args) {
    return npm(['exec', '--offline', '--', 'nisi', ...args], consumerDir, `nisi ${args[0] ?? ''}`);
  }

  const help = cli(['--help']);
  requireSuccess(help, 'installed help');
  assert.match(help.stdout, /Usage:[\s\S]*nisi demo[\s\S]*nisi local-model/);

  const version = cli(['--version']);
  requireSuccess(version, 'installed version');
  assert.equal(version.stdout.trim(), packageJson.version);

  const installedEntry = path.join(consumerDir, 'node_modules', 'nisi', 'bin', 'nisi.mjs');
  const npmBin = path.join(consumerDir, 'node_modules', '.bin', process.platform === 'win32' ? 'nisi.cmd' : 'nisi');
  const preservedLink = path.join(tempRoot, 'nisi-preserved-link.mjs');
  let preservedLinkCheck = 'PASS';
  try {
    fs.symlinkSync(process.platform === 'win32' ? installedEntry : npmBin, preservedLink, 'file');
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) preservedLinkCheck = `SKIP_${error.code}`;
    else throw error;
  }
  if (preservedLinkCheck === 'PASS') {
    const preserved = spawnSync(process.execPath, ['--preserve-symlinks-main', preservedLink, '--version'], {
      cwd: consumerDir,
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 128 * 1024,
    });
    assert.equal(preserved.status, 0, preserved.stderr || preserved.stdout);
    assert.equal(preserved.stdout.trim(), packageJson.version);
    assert.equal(preserved.stderr, '');
    const preservedDemo = spawnSync(process.execPath, ['--preserve-symlinks-main', preservedLink, 'demo'], {
      cwd: consumerDir,
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 128 * 1024,
    });
    assert.equal(preservedDemo.status, 0, preservedDemo.stderr || preservedDemo.stdout);
    const preservedSummary = JSON.parse(preservedDemo.stdout);
    assert.equal(preservedSummary.outcome, 'COMPLETED');
    assert.equal(preservedSummary.reportStored, true);
  }

  const demo = cli(['demo']);
  requireSuccess(demo, 'installed deterministic demo');
  const summary = JSON.parse(demo.stdout);
  assert.equal(summary.outcome, 'COMPLETED');
  assert.equal(summary.repairAttempts, 1);
  assert.equal(summary.reportStored, true);
  assert.equal(summary.modelCalls, 0);

  const invalidModel = cli(['local-model', 'http://127.0.0.1:1/v1/chat/completions', 'same-model', 'same-model']);
  assert.equal(invalidModel.status, 2, invalidModel.stderr || invalidModel.stdout);
  assert.equal(invalidModel.stdout, '');
  assert.match(invalidModel.stderr, /Invalid command or arguments/);
  assert.doesNotMatch(`${invalidModel.stdout}\n${invalidModel.stderr}`, /127\.0\.0\.1|same-model/);

  console.log(JSON.stringify({
    status: 'PASS',
    package: `${packageJson.name}@${packageJson.version}`,
    archiveFiles: packedPaths.size,
    checks: ['packed public contents', 'offline install', 'installed help', 'installed version',
      `installed npm-bin preserved symlink and demo import (${preservedLinkCheck})`, 'installed demo',
      'malformed model args refuse without inference'],
  }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
