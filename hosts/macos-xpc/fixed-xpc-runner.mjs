// PRIVATE fixed native engineering cases, never a task-generated-code executor.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createOwnedChildObserver } from '../swift-verifier/owned-child.mjs';
import { parseFixedXpcClient, assertFixedXpcOutcomes } from './protocol.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(directory, '../..');
const CASES = Object.freeze({
  valid: Object.freeze({ id: 0, status: 'REPLY_RECEIVED', exitCode: 0 }),
  'malformed-request': Object.freeze({ id: 1, status: 'MALFORMED', exitCode: 70 }),
  'no-reply': Object.freeze({ id: 2, status: 'TIMEOUT', exitCode: 70 }),
});
const fail = code => { throw Object.assign(new Error(code), { code }); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hashFile = file => sha(fs.readFileSync(file));
const known = Buffer.from('nisi fixed probe\n');
const sourceNames = ['hosts/macos-xpc/probe-wire.h', 'hosts/macos-xpc/probe-service.m', 'hosts/macos-xpc/probe-client.m',
  'hosts/macos-xpc/protocol.mjs', 'hosts/macos-xpc/fixed-xpc-runner.mjs', 'hosts/swift-verifier/owned-child.mjs',
  'hosts/swift-verifier/protocol.mjs', 'workflow/contracts.mjs', 'canonical/canonical-json-v1.mjs', 'hosts/repository/snapshot-contract.mjs'];
const absent = file => {
  try { fs.lstatSync(file); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; }
};
export function requireFixedXpcOptIn(argv) {
  if (!Array.isArray(argv) || ![1, 2].includes(argv.length) || argv[0] !== '--run-fixed-private-xpc-probe') fail('XPC_OPT_IN_REQUIRED');
  const caseName = argv.length === 1 ? 'valid' : typeof argv[1] === 'string' && argv[1].startsWith('--case=') ? argv[1].slice(7) : '';
  if (!Object.hasOwn(CASES, caseName)) fail('XPC_CASE');
  return caseName;
}
export function assertFixedXpcCase(parsed, caseName, durationMs) {
  if (!Object.hasOwn(CASES, caseName) || !Number.isSafeInteger(durationMs) || durationMs < 0 || durationMs >= 8000) fail('XPC_CASE_OBSERVATION');
  if (parsed?.client?.status !== CASES[caseName].status || parsed.client.authorizing !== false) fail('XPC_CASE_STATUS');
  if (caseName === 'valid') assertFixedXpcOutcomes(parsed.reply);
  else if (parsed.reply !== null || parsed.client.replyBase64 !== '') fail('XPC_CASE_NEGATIVE_REPLY');
  if (caseName === 'no-reply' && durationMs < 5000) fail('XPC_CASE_EARLY_TIMEOUT');
}
// Writer is a synchronous trusted host callback. An exception or non-void result
// leaves persistence uncertain; the returned result must not remain observed.
export function persistFixedXpcTerminal(record, writer) {
  if (!record || typeof record !== 'object' || typeof record.root !== 'string' || record.root.length === 0 ||
      !['INCONCLUSIVE', 'FIXED_XPC_CASE_OBSERVED'].includes(record.status) || typeof writer !== 'function') fail('XPC_TERMINAL_INPUT');
  try {
    if (writer(record) !== undefined) throw Error('XPC_TERMINAL_NONVOID');
    return record;
  } catch (error) {
    return { ...record, status: 'INCONCLUSIVE', terminalPersistence: { status: 'FAILED_OR_UNCERTAIN', code: typeof error?.code === 'string' ? error.code : 'XPC_TERMINAL_WRITE' } };
  }
}
function exactFile(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size !== known.length) fail('XPC_FILE_SHAPE');
    const bytes = fs.readFileSync(fd);
    if (!bytes.equals(known)) fail('XPC_FILE_BYTES');
    return { path: file, byteLength: bytes.length, sha256: sha(bytes) };
  } finally { fs.closeSync(fd); }
}
function bundleTree(directory) {
  const result = {};
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else { if (!entry.isFile() || entry.isSymbolicLink()) fail('XPC_BUNDLE_ENTRY'); result[path.relative(directory, file)] = hashFile(file); }
    }
  }
  visit(directory); return result;
}

export async function runFixedPrivateXpcProbe(argv) {
  const caseName = requireFixedXpcOptIn(argv); // before filesystem/build/launch effects
  if (process.platform !== 'darwin' || process.arch !== 'arm64') fail('XPC_PLATFORM');
  const parent = path.join(project, '.build');
  if (fs.realpathSync(parent) !== parent || !fs.lstatSync(parent).isDirectory()) fail('XPC_BUILD_PARENT');
  const sourceManifest = Object.fromEntries(sourceNames.map(name => [name, hashFile(path.join(project, name))]));
  const runId = randomBytes(16).toString('hex');
  const hostId = `local.nisi.xpcprobe.host.r${runId}`, serviceId = `local.nisi.xpcprobe.service.r${runId}`;
  const containers = [hostId, serviceId].map(id => ({ path: path.join(os.homedir(), 'Library/Containers', id), existedBefore: false, existsAfter: null, removed: false }));
  for (const container of containers) if (!absent(container.path)) fail('XPC_PREEXISTING_CONTAINER');
  const root = fs.mkdtempSync(path.join(parent, 'fixed-private-xpc-'));
  let record = { schemaVersion: 'nisi-fixed-private-xpc-run-v1', createdAt: new Date().toISOString(), status: 'INCONCLUSIVE',
    root, runId, caseName, fixtureCase: CASES[caseName], hostId, serviceId, sourceManifest, containers, commands: [],
    authorizing: false, generatedCodeExecuted: false, developerIdUsed: false, completeIsolation: false,
    nativeProductAccepted: false, serviceTerminationProven: false, runtimeServiceIdentityAttested: false };
  const write = (name, value) => fs.writeFileSync(path.join(root, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  let sequence = 0;
  function command(label, exe, args, input) {
    const r = spawnSync(exe, args, { cwd: root, env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TMPDIR: root }, input,
      encoding: 'utf8', timeout: 30000, maxBuffer: 1048576, killSignal: 'SIGKILL' });
    const item = { label, exe, args, exitCode: r.status, signal: r.signal, error: r.error?.code ?? null, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    record.commands.push(item); write(`command-${++sequence}.json`, item);
    if (r.error || r.status !== 0 || r.signal) fail('XPC_BUILD_OR_SIGNATURE');
    return item.stdout;
  }
  try {
    fs.chmodSync(root, 0o700);
    assert.equal(fs.realpathSync(root), root); assert.equal(path.dirname(root), parent);
    assert.equal(fs.lstatSync(root).mode & 0o777, 0o700);
    if (!/^[A-Za-z0-9/_. -]+$/.test(root) || !/^[A-Za-z0-9/_. -]+$/.test(os.homedir())) fail('XPC_PATH_ENCODING');
    const app = path.join(root, 'ProbeHost.app'), service = path.join(app, 'Contents/XPCServices/ProbeService.xpc');
    const hostExe = path.join(app, 'Contents/MacOS/ProbeHost'), serviceExe = path.join(service, 'Contents/MacOS/ProbeService');
    fs.mkdirSync(path.dirname(hostExe), { recursive: true, mode: 0o700 }); fs.mkdirSync(path.dirname(serviceExe), { recursive: true, mode: 0o700 });
    for (const name of ['probe-wire.h', 'probe-service.m', 'probe-client.m']) {
      fs.copyFileSync(path.join(directory, name), path.join(root, name), fs.constants.COPYFILE_EXCL);
      assert.equal(hashFile(path.join(root, name)), sourceManifest[`hosts/macos-xpc/${name}`]);
    }
    const macros = { NISI_RUN_ID: runId, NISI_ROOT: root, NISI_SERVICE_ID: serviceId,
      NISI_SERVICE_HOME: path.join(containers[1].path, 'Data'), NISI_CLIENT_HOME: path.join(containers[0].path, 'Data') };
    write('probe-config.h', Object.entries(macros).map(([key, value]) => `#define ${key} @${JSON.stringify(value)}\n`).join('') + `#define NISI_PROBE_CASE ${CASES[caseName].id}\n`);
    const plist = (id, exe, type, extra = '') => `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleExecutable</key><string>${exe}</string><key>CFBundlePackageType</key><string>${type}</string><key>CFBundleVersion</key><string>1</string>${extra}</dict></plist>\n`;
    write('ProbeHost.app/Contents/Info.plist', plist(hostId, 'ProbeHost', 'APPL'));
    write('ProbeHost.app/Contents/XPCServices/ProbeService.xpc/Contents/Info.plist', plist(serviceId, 'ProbeService', 'XPC!', '<key>XPCService</key><dict><key>ServiceType</key><string>Application</string></dict>'));
    write('entitlements.plist', '<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.app-sandbox</key><true/></dict></plist>\n');
    write('outside-canary.txt', known.toString());
    record.inputs = Object.fromEntries(['probe-wire.h', 'probe-client.m', 'probe-service.m', 'probe-config.h', 'entitlements.plist', 'outside-canary.txt'].map(name => [name, hashFile(path.join(root, name))]));
    record.platform = { node: process.version, arch: process.arch, osRelease: os.release(),
      macOS: command('macOS', '/usr/bin/sw_vers', []), developerDirectory: command('developer directory', '/usr/bin/xcode-select', ['-p']).trim() };
    const flags = ['-fobjc-arc', '-fblocks', '-Wall', '-Wextra', '-Werror', '-framework', 'Foundation', '-mmacosx-version-min=26.0'];
    command('compile fixed service', '/usr/bin/clang', [...flags, 'probe-service.m', '-o', serviceExe]);
    command('compile fixed client', '/usr/bin/clang', [...flags, 'probe-client.m', '-o', hostExe]);
    for (const [name, bundle] of [['service', service], ['host', app]])
      command(`ad-hoc sign ${name}`, '/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', '--entitlements', path.join(root, 'entitlements.plist'), bundle]);
    record.entitlements = {};
    for (const [name, bundle] of [['service', service], ['host', app]]) {
      command(`strict verify ${name}`, '/usr/bin/codesign', ['--verify', '--strict', '--verbose=4', bundle]);
      const raw = command(`read signed entitlements ${name}`, '/usr/bin/codesign', ['-d', '--xml', '--entitlements', '-', bundle]);
      const value = JSON.parse(command(`decode signed entitlements ${name}`, '/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'], raw));
      assert.deepEqual(value, { 'com.apple.security.app-sandbox': true }); record.entitlements[name] = value;
    }
    command('strict nested verification', '/usr/bin/codesign', ['--verify', '--strict', '--deep', '--verbose=4', app]);
    record.bundleTree = bundleTree(app);
    function stable() {
      for (const [name, hash] of Object.entries(sourceManifest)) assert.equal(hashFile(path.join(project, name)), hash, name);
      for (const [name, hash] of Object.entries(record.inputs)) assert.equal(hashFile(path.join(root, name)), hash, name);
      assert.deepEqual(bundleTree(app), record.bundleTree);
    }
    stable(); for (const container of containers) if (!absent(container.path)) fail('XPC_PREEXISTING_CONTAINER');
    const own = path.join(containers[1].path, 'Data/nisi-fixed-probe.txt'), outside = path.join(root, 'outside-write.txt');
    if (!absent(own) || !absent(outside)) fail('XPC_PREEXISTING_TARGET');
    let observedPid = null;
    const owner = createOwnedChildObserver({ expectedExitCode: CASES[caseName].exitCode, timeoutMs: 8000, closeGraceMs: 1000, maximumOutputBytes: 16384,
      launch: () => {
        const child = spawn(hostExe, [], { cwd: root, env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TMPDIR: root }, stdio: ['pipe', 'pipe', 'pipe'] });
        observedPid = child.pid ?? null; return child;
      } });
    const result = await owner.run({ input: Buffer.alloc(0), validate: stdout => parseFixedXpcClient(stdout, {
      runId, expectedPid: observedPid, expectedClientHome: path.join(containers[0].path, 'Data'), expectedServiceHome: path.join(containers[1].path, 'Data'),
    }) });
    record.client = { parentObservedPid: observedPid, expectedExitCode: CASES[caseName].exitCode, executableSha256: hashFile(hostExe), result };
    write('client-run.json', record.client);
    if (result.cause !== null || result.validated === null) fail('XPC_CLIENT_INCONCLUSIVE');
    assertFixedXpcCase(result.validated, caseName, result.process.durationMs);
    stable(); if (!absent(outside)) fail('XPC_OUTSIDE_EFFECT');
    record.postconditions = [exactFile(path.join(root, 'outside-canary.txt'))];
    if (caseName === 'valid') record.postconditions.push(exactFile(own));
    else { if (!absent(own)) fail('XPC_NEGATIVE_BODY_EFFECT'); record.postconditions.push({ path: own, absent: true }); }
    record.postconditions.push({ path: outside, absent: true });
    record.status = 'FIXED_XPC_CASE_OBSERVED';
  } catch (error) {
    record.failure = { code: typeof error?.code === 'string' ? error.code : 'XPC_ASSERTION', message: String(error.message).slice(0, 1500) };
  } finally {
    for (const container of containers) {
      try { container.existsAfter = !absent(container.path); } catch { container.observationError = true; record.status = 'INCONCLUSIVE'; }
    }
    record.completedAt = new Date().toISOString();
    record = persistFixedXpcTerminal(record, value => write('terminal.json', value));
  }
  return record;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runFixedPrivateXpcProbe(process.argv.slice(2));
    console.log(JSON.stringify({ status: result.status, caseName: result.caseName, root: result.root, containers: result.containers,
      failure: result.failure ?? null, terminalPersistence: result.terminalPersistence ?? null, authorizing: false }));
    process.exitCode = result.status === 'FIXED_XPC_CASE_OBSERVED' ? 0 : 1;
  } catch (error) {
    console.error(JSON.stringify({ status: 'NOT_RUN', code: error.code ?? 'XPC_SETUP', authorizing: false })); process.exitCode = 2;
  }
}
