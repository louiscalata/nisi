// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
// Exercise the exact packed public package through its installed npm bin.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this check with `npm run check:cli-package`.');

// Documented names each public entry point must provide after installation.
const KEY_EXPORTS = {
  '.': ['runWorkflow', 'createFileAccessPolicy', 'canonicalizeJsonV1', 'createLocalChatAuthorAdapter', 'createLocalChatReviewerAdapter'],
  './workflow': ['runWorkflow', 'createTaskSpecification', 'createCandidate'],
  './policy': ['createFileAccessPolicy'],
  './serialization': ['canonicalizeJsonV1', 'canonicalizeJSONV1'],
  './adapters/apple-foundation-models': ['createAppleFoundationModelsAdapter'],
  './adapters/local-chat': ['createLocalChatAuthorAdapter', 'createLocalChatReviewerAdapter'],
  './history/run-journal': ['createRunJournal', 'reopen'],
  './history/run-journal-store': ['writeSerializedJournal', 'readSerializedJournal'],
};
const TEXT_FILE = /(?:\.(?:[cm]?js|json|md)|^LICENSE)$/;

// Regular files of the gzip-compressed ustar archive, keyed by package path.
// An entry this reader cannot name (a PAX long path, say) fails the comparison
// with npm's own listing rather than being skipped.
function readArchive(file) {
  const tar = zlib.gunzipSync(fs.readFileSync(file));
  const field = (header, start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0[\s\S]*$/, '');
  const entries = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const size = Number.parseInt(field(header, 124, 12).trim() || '0', 8);
    const prefix = field(header, 345, 155);
    const name = `${prefix ? `${prefix}/` : ''}${field(header, 0, 100)}`;
    const type = field(header, 156, 1);
    assert(Number.isSafeInteger(size) && ['0', ''].includes(type) && name.startsWith('package/'), `Unexpected archive entry ${name}.`);
    entries.set(name.slice('package/'.length), tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

// Relative Markdown and HTML targets, resolved against the package root.
function relativeTargets(markdown) {
  const targets = [...markdown.matchAll(/\]\(\s*<?([^)\s>]*)/g), ...markdown.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/g)]
    .map(match => match[1]);
  return targets.filter(target => !/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target));
}

async function closedLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

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
  for (const [key, target] of Object.entries(packageJson.exports)) {
    assert(packedPaths.has(target.replace(/^\.\//, '')), `Archive is missing export ${key} (${target}).`);
  }

  // Inspect the archive bytes themselves: line endings and README links must not
  // depend on the operating system or checkout that built the archive.
  const archiveFiles = readArchive(archive);
  assert.deepEqual([...archiveFiles.keys()].sort(), [...packedPaths].sort(), 'Archive entries differ from the npm pack listing.');
  const crlfFiles = [...archiveFiles].filter(([file, bytes]) => TEXT_FILE.test(file) && bytes.includes('\r\n')).map(([file]) => file);
  assert.deepEqual(crlfFiles, [], 'Packed text files must use LF line endings.');
  const readmeTargets = relativeTargets(archiveFiles.get('README.md').toString('utf8'));
  for (const target of readmeTargets) {
    const file = path.posix.normalize(decodeURIComponent(target.split(/[?#]/)[0]));
    assert(packedPaths.has(file), `Packed README links to ${target}, which the archive does not contain.`);
  }

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
  assert.match(invalidModel.stderr, /\(LOCAL_MODEL_NAMES_EQUAL\)/);
  assert.doesNotMatch(`${invalidModel.stdout}\n${invalidModel.stderr}`, /127\.0\.0\.1|same-model/);

  // Well-formed arguments against a port nobody listens on: the installed
  // workflow must load and block on its first author call. A broken install
  // exits 1 with a load failure here, never 2 like the refusal above.
  const port = await closedLoopbackPort();
  const closedPort = cli(['local-model', `http://127.0.0.1:${port}/v1/chat/completions`, 'author-model', 'reviewer-model']);
  assert.equal(closedPort.status, 1, closedPort.stderr || closedPort.stdout);
  assert.doesNotMatch(closedPort.stderr, /could not be loaded|Invalid command/, `Installed local-model did not run: ${closedPort.stderr}`);
  assert.deepEqual(JSON.parse(closedPort.stdout), { outcome: 'BLOCKED', code: 'ADAPTER_EXCEPTION', repairAttempts: 0,
    authorCalls: 1, reviewerCalls: 0, authorCode: 'LOCAL_CHAT_UNAVAILABLE', reviewerCode: null });

  // Every package.json export must load from the installed archive with the
  // same export names as the checkout, including the documented key names.
  const specifiers = Object.keys(packageJson.exports).map(key => key === '.' ? packageJson.name : `${packageJson.name}/${key.slice(2)}`);
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `const names = {};
for (const specifier of ${JSON.stringify(specifiers)}) {
  names[specifier] = Object.keys(await import(specifier, specifier.endsWith('.json') ? { with: { type: 'json' } } : undefined)).sort();
}
console.log(JSON.stringify(names));`], { cwd: consumerDir, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
  const installedNames = JSON.parse(probe.stdout);
  for (const [key, target] of Object.entries(packageJson.exports)) {
    const specifier = key === '.' ? packageJson.name : `${packageJson.name}/${key.slice(2)}`;
    const source = await import(pathToFileURL(path.join(root, target)).href, target.endsWith('.json') ? { with: { type: 'json' } } : undefined);
    assert.deepEqual(installedNames[specifier], Object.keys(source).sort(), `Installed ${specifier} exports differ from the checkout.`);
    for (const name of KEY_EXPORTS[key] ?? []) assert(installedNames[specifier].includes(name), `Installed ${specifier} is missing ${name}.`);
  }
  assert.deepEqual(Object.keys(KEY_EXPORTS).filter(key => !(key in packageJson.exports)), [], 'A documented entry point is not exported.');

  console.log(JSON.stringify({
    status: 'PASS',
    package: `${packageJson.name}@${packageJson.version}`,
    archiveFiles: packedPaths.size,
    checks: ['packed public contents', 'packed export targets', 'LF-only packed text',
      `packed README relative links resolve (${readmeTargets.length})`, 'offline install', 'installed help', 'installed version',
      `installed npm-bin preserved symlink and demo import (${preservedLinkCheck})`, 'installed demo',
      'malformed model args refuse without inference', 'installed local-model loads and blocks on a closed loopback port',
      `installed library exports (${specifiers.length})`],
  }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
