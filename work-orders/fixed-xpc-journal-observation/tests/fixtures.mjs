import { createHash } from 'node:crypto';
import { parseFixedXpcClient } from '../frozen/protocol.mjs';

const RUN_ID = '0123456789abcdef0123456789abcdef';
const CHILD_PID = 101;
const SERVICE_PID = 202;
const ROOT = '/synthetic/nisi/root';
const HOST_ID = `local.nisi.xpcprobe.host.r${RUN_ID}`;
const SERVICE_ID = `local.nisi.xpcprobe.service.r${RUN_ID}`;
const HOST_HOME = `/synthetic/containers/${HOST_ID}/Data`;
const SERVICE_HOME = `/synthetic/containers/${SERVICE_ID}/Data`;
const KNOWN = Buffer.from('nisi fixed probe\n');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const CASES = Object.freeze({
  valid: Object.freeze({ id: 0, status: 'REPLY_RECEIVED', exitCode: 0, durationMs: 300 }),
  'malformed-request': Object.freeze({ id: 1, status: 'MALFORMED', exitCode: 70, durationMs: 300 }),
  'no-reply': Object.freeze({ id: 2, status: 'TIMEOUT', exitCode: 70, durationMs: 5300 })
});
const SOURCE_NAMES = Object.freeze([
  'hosts/macos-xpc/probe-wire.h',
  'hosts/macos-xpc/probe-service.m',
  'hosts/macos-xpc/probe-client.m',
  'hosts/macos-xpc/protocol.mjs',
  'hosts/macos-xpc/fixed-xpc-runner.mjs',
  'hosts/swift-verifier/owned-child.mjs',
  'hosts/swift-verifier/protocol.mjs',
  'workflow/contracts.mjs',
  'canonical/canonical-json-v1.mjs',
  'hosts/repository/snapshot-contract.mjs'
]);
const sourceManifest = () => Object.fromEntries(SOURCE_NAMES.map((name, index) => [
  name, (index + 1).toString(16).padStart(64, '0')
]));

function replyFrame() {
  const home = Buffer.from(SERVICE_HOME);
  const bytes = Buffer.alloc(121 + home.length);
  bytes.write('NRS1');
  bytes.write(RUN_ID, 4);
  bytes.writeUInt32BE(CHILD_PID, 36);
  bytes.writeUInt32BE(SERVICE_PID, 40);
  bytes.writeUInt16BE(home.length, 44);
  home.copy(bytes, 46);
  for (let index = 0; index < 15; index++) bytes[46 + home.length + index * 5] = 1;
  for (const [index, status, errno] of [
    [6, 2, 1], [7, 0, 0], [8, 0, 0], [9, 2, 13], [10, 0, 0], [11, 0, 0], [13, 2, 1]
  ]) {
    const offset = 46 + home.length + index * 5;
    bytes[offset] = status;
    bytes.writeUInt32BE(errno, offset + 1);
  }
  return bytes;
}

function clientBytes(spec) {
  const value = {
    authorizing: false,
    home: HOST_HOME,
    pid: CHILD_PID,
    replyBase64: spec.status === 'REPLY_RECEIVED' ? replyFrame().toString('base64') : '',
    runId: RUN_ID,
    schemaVersion: 'nisi-fixed-xpc-client-v1',
    status: spec.status
  };
  return Buffer.from(JSON.stringify(value) + '\n');
}

export function makeRecord(caseName = 'valid') {
  const spec = CASES[caseName];
  if (!spec) throw new TypeError('unknown synthetic fixed XPC case');
  const stdout = clientBytes(spec);
  // The real terminal record is serialized JSON evidence, so detach the
  // authoritative parser's frozen return into the ordinary-data shape stored.
  const validated = JSON.parse(JSON.stringify(parseFixedXpcClient(stdout, {
    runId: RUN_ID,
    expectedPid: CHILD_PID,
    expectedClientHome: HOST_HOME,
    expectedServiceHome: SERVICE_HOME
  })));
  const process = {
    started: true, closed: true, drain: 'CONFIRMED', exitCode: spec.exitCode, signal: null,
    errorCode: null, cancelRequested: false, deadlineExceeded: false, durationMs: spec.durationMs
  };
  const client = {
    parentObservedPid: CHILD_PID,
    expectedExitCode: spec.exitCode,
    executableSha256: 'a'.repeat(64),
    result: {
      schemaVersion: 1,
      process,
      outputs: {
        stdout: { capturedBytes: stdout.length, observedBytes: stdout.length, sha256: sha256(stdout), truncated: false },
        stderr: { capturedBytes: 0, observedBytes: 0, sha256: sha256(Buffer.alloc(0)), truncated: false }
      },
      stdoutHex: stdout.toString('hex'), stderrHex: '', cause: null, validated,
      lifecycle: { operation: 1, launchCalled: true, closeObserved: true, exited: true,
        killRequested: false, killReturned: null, killAtMs: null, ownerState: 'IDLE', directChildOnly: true },
      authorizing: false
    }
  };
  const containers = [HOST_ID, SERVICE_ID].map(id => ({
    path: `/synthetic/containers/${id}`, existedBefore: false, existsAfter: true, removed: false
  }));
  const postconditions = [{ path: `${ROOT}/outside-canary.txt`, byteLength: KNOWN.length, sha256: sha256(KNOWN) }];
  if (caseName === 'valid') postconditions.push({ path: `${SERVICE_HOME}/nisi-fixed-probe.txt`, byteLength: KNOWN.length, sha256: sha256(KNOWN) });
  else postconditions.push({ path: `${SERVICE_HOME}/nisi-fixed-probe.txt`, absent: true });
  postconditions.push({ path: `${ROOT}/outside-write.txt`, absent: true });
  return {
    schemaVersion: 'nisi-fixed-private-xpc-run-v1', createdAt: '2026-09-13T20:00:00.000Z',
    status: 'FIXED_XPC_CASE_OBSERVED', root: ROOT, runId: RUN_ID, caseName,
    fixtureCase: { id: spec.id, status: spec.status, exitCode: spec.exitCode }, hostId: HOST_ID, serviceId: SERVICE_ID,
    sourceManifest: sourceManifest(), containers, commands: [], authorizing: false, generatedCodeExecuted: false,
    developerIdUsed: false, completeIsolation: false, nativeProductAccepted: false, serviceTerminationProven: false,
    runtimeServiceIdentityAttested: false, inputs: { 'outside-canary.txt': sha256(KNOWN) },
    platform: { node: 'v24.8.0', arch: 'arm64', osRelease: '25.0.0', macOS: 'synthetic', developerDirectory: '/synthetic/Xcode' },
    entitlements: { service: { 'com.apple.security.app-sandbox': true }, host: { 'com.apple.security.app-sandbox': true } },
    bundleTree: { 'Contents/MacOS/ProbeHost': 'b'.repeat(64) }, client, postconditions,
    completedAt: '2026-09-13T20:00:06.000Z'
  };
}
