// PRIVATE fixed capability experiment, NOT an executor for generated code.
// Only the exact opt-in below permits build/sign/launch. No path/command override.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createOwnedChildObserver } from '../swift-verifier/owned-child.mjs';
import { parseFixedProbeV1 } from './fixed-probe-parser.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(directory, '../..');
const OPT_IN = '--run-fixed-app-sandbox-probe';
const knownBytes = Buffer.from('nisi fixed probe\n');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hashFile = file => sha(fs.readFileSync(file));
const fail = code => { throw Object.assign(new Error(code), { code }); };
const absent = file => {
  try { fs.lstatSync(file); return false; } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
};
function exactFile(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size !== knownBytes.length) fail('PROBE_FILE_SHAPE');
    const bytes = fs.readFileSync(fd);
    if (!bytes.equals(knownBytes)) fail('PROBE_FILE_BYTES');
    return { path: file, byteLength: bytes.length, sha256: sha(bytes) };
  } finally { fs.closeSync(fd); }
}

export function requireFixedProbeOptIn(argv) {
  if (!Array.isArray(argv) || argv.length !== 1 || argv[0] !== OPT_IN) fail('PROBE_EXPLICIT_OPT_IN_REQUIRED');
}

// Data adjudication only. Unexpected/ambiguous behavior is retained, not repaired
// by changing permissions or trying the same experiment again.
export function assertFixedProbeOutcomes(parsed, mode) {
  if (!['sandbox', 'control'].includes(mode) || parsed?.meta?.mode !== mode) fail('PROBE_MODE');
  const rows = Object.fromEntries(parsed.rows.map(row => [row.operation, row]));
  const expect = (name, outcome) => {
    if (rows[name]?.outcome !== outcome) fail('PROBE_UNEXPECTED_OPERATION');
  };
  for (const name of ['own-open-write', 'own-write', 'own-close-write', 'own-open-read', 'own-read', 'own-close-read', 'fixed-child-spawn', 'fixed-child-wait']) expect(name, 'ALLOWED');
  if (mode === 'control') {
    for (const row of parsed.rows) if (row.outcome !== 'ALLOWED') fail('PROBE_CONTROL_FAILED');
  } else {
    for (const name of ['outside-open-read', 'outside-open-write']) expect(name, 'DENIED');
    for (const name of ['outside-read', 'outside-close-read', 'outside-write', 'outside-close-write']) expect(name, 'NOT_RUN');
    if (rows['socket-create']?.outcome === 'DENIED') {
      expect('socket-bind', 'NOT_RUN'); expect('socket-close', 'NOT_RUN');
    } else {
      expect('socket-create', 'ALLOWED'); expect('socket-bind', 'DENIED'); expect('socket-close', 'ALLOWED');
    }
  }
}

export async function runFixedAppSandboxProbe(argv) {
  requireFixedProbeOptIn(argv); // before all filesystem/build/launch side effects
  if (process.platform !== 'darwin' || process.arch !== 'arm64') fail('PROBE_PLATFORM_NOT_SUPPORTED');
  const parent = path.join(project, '.build');
  if (fs.realpathSync(parent) !== parent || !fs.lstatSync(parent).isDirectory()) fail('PROBE_BUILD_PARENT');
  const runId = randomBytes(16).toString('hex');
  const bundleId = `local.nisi.fixedprobe.r${runId}`;
  const home = os.homedir();
  const container = path.join(home, 'Library/Containers', bundleId);
  const sources = ['hosts/macos-sandbox/fixed-probe.m', 'hosts/macos-sandbox/fixed-probe-runner.mjs', 'hosts/macos-sandbox/fixed-probe-parser.mjs',
    'hosts/swift-verifier/owned-child.mjs', 'hosts/swift-verifier/protocol.mjs', 'workflow/contracts.mjs',
    'canonical/canonical-json-v1.mjs', 'hosts/repository/snapshot-contract.mjs'];
  const sourceManifest = Object.fromEntries(sources.map(name => [name, hashFile(path.join(project, name))]));
  const containerExisted = !absent(container);
  if (containerExisted) fail('PROBE_PREEXISTING_CONTAINER');
  // All fallible source reads and identity preparation precede root creation.
  const root = fs.mkdtempSync(path.join(parent, 'fixed-app-sandbox-'));
  const ownSandboxFile = path.join(container, 'Data/nisi-fixed-probe.txt');
  const outsideTarget = path.join(root, 'outside-write.txt');
  const canary = path.join(root, 'outside-canary.txt');
  const app = path.join(root, 'Probe.app');
  const sandboxExe = path.join(app, 'Contents/MacOS/NisiProbe');
  const controlExe = path.join(root, 'control');
  const record = {
    schemaVersion: 'nisi-repeatable-fixed-app-sandbox-v1', runId, root, bundleId,
    createdAt: new Date().toISOString(), status: 'INCOMPLETE',
    sourceManifest,
    commands: [], runs: [], postconditions: [],
    container: { path: container, existedBefore: containerExisted, existsAfter: null, removed: false },
    generatedCodeExecuted: false, completeIsolation: false, descendantCleanupProven: false,
    nativeProductAccepted: false, authorizing: false, developerIdUsed: false,
    control: 'Same copied source/header and outside target. Compilation differs by NISI_EXPECT_SANDBOX=0; sandbox is bundled and ad-hoc signed with App Sandbox, control is a bare executable ad-hoc signed with an empty entitlement dictionary.',
    limits: ['Trusted static checkout and imported dependencies, not hostile writer protection.', 'Parent PID comparison, not OS executable-path attestation.', 'Fixed fixture-adjudicated per-syscall labels, not raw return-value/child-wait-status telemetry.', 'Direct-child observation only; no descendant containment.', 'Only fixed file and IPv4 socket/bind operations.', 'No XPC, Node candidate, resource-exhaustion or complete-product acceptance.']
  };
  let commandSequence = 0;
  const write = (name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  function command(label, exe, args, input) {
    const r = spawnSync(exe, args, { cwd: root, env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TMPDIR: root }, input, encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL', maxBuffer: 1048576 });
    const item = { label, exe, args, exitCode: r.status, signal: r.signal, error: r.error?.code ?? null, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    record.commands.push(item); write(`command-${++commandSequence}.json`, item);
    if (r.error || r.status !== 0 || r.signal) fail('PROBE_BUILD_OR_SIGNATURE_FAILED');
    return item;
  }
  try {
    fs.chmodSync(root, 0o700);
    const stat = fs.lstatSync(root);
    if (path.dirname(root) !== parent || fs.realpathSync(root) !== root || !stat.isDirectory() || (stat.mode & 0o777) !== 0o700) fail('PROBE_ROOT');
    if (record.container.existedBefore || !absent(outsideTarget)) fail('PROBE_PREEXISTING_TARGET');
    if (!/^[A-Za-z0-9/_. -]+$/.test(root) || !/^[A-Za-z0-9/_. -]+$/.test(home)) fail('PROBE_ROOT_ENCODING');
    fs.mkdirSync(path.dirname(sandboxExe), { recursive: true, mode: 0o700 });
    fs.writeFileSync(canary, knownBytes, { flag: 'wx', mode: 0o600 });
    fs.copyFileSync(path.join(directory, 'fixed-probe.m'), path.join(root, 'probe.m'), fs.constants.COPYFILE_EXCL);
    const header = `#define NISI_ROOT @${JSON.stringify(root)}\n#define NISI_RUN_ID @${JSON.stringify(runId)}\n#define NISI_SANDBOX_HOME @${JSON.stringify(path.join(container, 'Data'))}\n`;
    fs.writeFileSync(path.join(root, 'probe-config.h'), header, { flag: 'wx' });
    const info = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${bundleId}</string><key>CFBundleExecutable</key><string>NisiProbe</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>LSUIElement</key><true/></dict></plist>\n`;
    fs.writeFileSync(path.join(app, 'Contents/Info.plist'), info, { flag: 'wx' });
    fs.writeFileSync(path.join(root, 'entitlements.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.app-sandbox</key><true/></dict></plist>\n', { flag: 'wx' });
    fs.writeFileSync(path.join(root, 'empty-entitlements.plist'), '<?xml version="1.0"?><plist version="1.0"><dict/></plist>\n', { flag: 'wx' });
    record.inputs = Object.fromEntries(['probe.m', 'probe-config.h', 'outside-canary.txt', 'entitlements.plist', 'empty-entitlements.plist', 'Probe.app/Contents/Info.plist'].map(p => [p, hashFile(path.join(root, p))]));
    assert.equal(record.inputs['probe.m'], record.sourceManifest['hosts/macos-sandbox/fixed-probe.m']);
    const compile = ['-fobjc-arc', '-Wall', '-Wextra', '-Werror', '-framework', 'Foundation', '-mmacosx-version-min=26.0', 'probe.m'];
    command('compile fixed sandbox', '/usr/bin/clang', [...compile, '-o', sandboxExe]);
    command('compile fixed control', '/usr/bin/clang', [...compile, '-DNISI_EXPECT_SANDBOX=0', '-o', controlExe]);
    command('ad-hoc sign fixed app', '/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', '--entitlements', path.join(root, 'entitlements.plist'), app]);
    command('verify fixed app', '/usr/bin/codesign', ['--verify', '--strict', '--verbose=4', app]);
    const entitlements = command('read signed entitlements', '/usr/bin/codesign', ['-d', '--xml', '--entitlements', '-', app]);
    const decoded = command('parse signed entitlements', '/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'], entitlements.stdout);
    assert.deepEqual(JSON.parse(decoded.stdout), { 'com.apple.security.app-sandbox': true });
    record.signedEntitlements = JSON.parse(decoded.stdout);
    command('ad-hoc sign fixed control', '/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', '--entitlements', path.join(root, 'empty-entitlements.plist'), controlExe]);
    command('verify fixed control', '/usr/bin/codesign', ['--verify', '--strict', '--verbose=4', controlExe]);
    const controlEnt = command('read control entitlements', '/usr/bin/codesign', ['-d', '--xml', '--entitlements', '-', controlExe]);
    const controlDecoded = command('parse control entitlements', '/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'], controlEnt.stdout);
    assert.deepEqual(JSON.parse(controlDecoded.stdout), {});
    record.controlEntitlements = JSON.parse(controlDecoded.stdout);
    record.binaries = { sandbox: hashFile(sandboxExe), control: hashFile(controlExe) };
    record.platform = { architecture: process.arch, osRelease: os.release(), node: process.version,
      macOS: command('macOS version', '/usr/bin/sw_vers', []).stdout,
      developerDirectory: command('developer directory', '/usr/bin/xcode-select', ['-p']).stdout.trim() };
    const stable = () => {
      for (const [p, h] of Object.entries(record.inputs)) assert.equal(hashFile(path.join(root, p)), h, p);
      for (const [p, h] of Object.entries(record.sourceManifest)) assert.equal(hashFile(path.join(project, p)), h, p);
      assert.equal(hashFile(sandboxExe), record.binaries.sandbox);
      assert.equal(hashFile(controlExe), record.binaries.control);
    };
    for (const mode of ['sandbox', 'control']) {
      stable();
      if (!absent(outsideTarget)) fail('PROBE_PREEXISTING_TARGET');
      const own = mode === 'sandbox' ? ownSandboxFile : path.join(root, 'own-control.txt');
      if (!absent(own)) fail('PROBE_PREEXISTING_OWN_FILE');
      if (mode === 'sandbox' && !absent(container)) fail('PROBE_PREEXISTING_CONTAINER');
      let parentObservedPid = null;
      const exe = mode === 'sandbox' ? sandboxExe : controlExe;
      const owner = createOwnedChildObserver({ timeoutMs: 8000, closeGraceMs: 1000, maximumOutputBytes: 32768,
        launch: () => {
          const child = spawn(exe, [], { cwd: root, env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TMPDIR: root }, stdio: ['pipe', 'pipe', 'pipe'] });
          parentObservedPid = child.pid ?? null;
          return child;
        }
      });
      const result = await owner.run({ input: Buffer.alloc(0), validate: stdout => parseFixedProbeV1(stdout, {
        runId, mode, expectedPid: parentObservedPid, expectedHome: mode === 'sandbox' ? path.join(container, 'Data') : home
      }) });
      const launch = { mode, exe, executableSha256: record.binaries[mode], parentObservedPid, result };
      record.runs.push(launch); write(`${mode}-run.json`, launch);
      if (result.cause !== null || result.validated === null) fail('PROBE_LAUNCH_OR_OUTPUT_INCONCLUSIVE');
      stable();
      assertFixedProbeOutcomes(result.validated, mode);
      if (mode === 'sandbox' && !absent(outsideTarget)) fail('PROBE_SANDBOX_OUTSIDE_EFFECT');
      record.postconditions.push(exactFile(own), exactFile(canary));
      if (mode === 'control') record.postconditions.push(exactFile(outsideTarget));
    }
    record.status = 'FIXED_CAPABILITY_OBSERVED';
  } catch (error) {
    record.status = 'INCONCLUSIVE';
    record.failure = { code: typeof error?.code === 'string' ? error.code : 'PROBE_ASSERTION', message: String(error.message).slice(0, 1024) };
  } finally {
    try { record.container.existsAfter = !absent(container); }
    catch { record.status = 'INCONCLUSIVE'; record.container.observationError = 'PROBE_CONTAINER_POSTCHECK_FAILED'; }
    record.completedAt = new Date().toISOString();
    try { write('terminal.json', record); }
    catch (error) {
      record.status = 'INCONCLUSIVE';
      record.terminalPersistence = { status: 'FAILED', code: error.code ?? 'PROBE_TERMINAL_WRITE_FAILED' };
    }
  }
  return record;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runFixedAppSandboxProbe(process.argv.slice(2));
    console.log(JSON.stringify({ status: result.status, root: result.root, container: result.container, runs: result.runs.length, failure: result.failure ?? null, terminalPersistence: result.terminalPersistence ?? null, authorizing: false }));
    process.exitCode = result.status === 'FIXED_CAPABILITY_OBSERVED' ? 0 : 1;
  } catch (error) {
    console.error(JSON.stringify({ status: 'NOT_RUN', code: error.code ?? 'PROBE_ERROR', authorizing: false }));
    process.exitCode = 2;
  }
}
