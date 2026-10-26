// C07 isolated integration oracle.  This file is intentionally staged only
// in the private candidate work order. Every observation is synthetic data
// from an already-issued fixture; no native process, provider, or network is
// started here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  admitNativeIncidentRerunV1,
  bindNativeIncidentRerunV1,
  isIssuedNativeIncidentAdmissionV1,
} from '../../../hosts/repository/native-incident-admission-v1.mjs';
import { createBoundaryNativeIncidentFixture } from '../../../tests/helpers/native-incident-source-fixture.mjs';
import {
  readNativeIncidentSourceInputV1,
  readNativeIncidentExecutionIdentityV1,
} from '../../../hosts/repository/native-incident-source-v1.mjs';
import { issuedSwiftChecksV1 } from '../../../hosts/swift-verifier/check-plan-v1.mjs';
import './native-incident-source-v1.test.mjs';

const NOW = 10_000;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]` :
  value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
const shallow = value => JSON.parse(JSON.stringify(value));

async function planFor(selectedPath = 'sources/multibyte.txt') {
  const f = await createBoundaryNativeIncidentFixture();
  const preview = f.host.incidentPreview();
  for (const row of preview.rows) {
    if (row.classification !== 'FAILURE_CANDIDATE') continue;
    const plan = f.host.nativeIncidentSourcePlan({ rowId: row.rowId });
    if (plan.status !== 'SOURCE_BOUND') continue;
    const input = readNativeIncidentSourceInputV1({ plan });
    if (input.artifact.relativePath !== selectedPath) continue;
    const original = f.plans.find(value => value.fingerprint === row.source.planFingerprint);
    const index = row.binding.checkIndex;
    const checks = issuedSwiftChecksV1(original);
    return {
      f, row, plan, input, original, index, checks,
      check: checks[index],
      identity: readNativeIncidentExecutionIdentityV1({ plan }),
    };
  }
  assert.fail('no issued source-bound boundary row');
}

function grantFrom(sourcePlan, now = NOW, overrides = {}) {
  const input = readNativeIncidentSourceInputV1({ plan: sourcePlan });
  const identity = readNativeIncidentExecutionIdentityV1({ plan: sourcePlan });
  return {
    schemaVersion: 'nisi-native-incident-rerun-grant/v1',
    grantId: 'native-grant-c07',
    sourcePlanDigest: sourcePlan.sourcePlanDigest,
    inputSha256: input.inputSha256,
    rowId: input.rowId,
    previewSha256: input.previewSha256,
    executionProfileSha256: identity.profileFingerprint,
    executableSha256: identity.executableSha256,
    issuedAt: now - 100,
    expiresAt: now + 900_000,
    revoked: false,
    scope: 'NATIVE_RERUN_ORIGINAL_SNAPSHOT_ONLY',
    rawContentPersisted: false,
    networkEgress: false,
    learningInfluence: false,
    ...overrides,
  };
}

function host(state = 'IDLE', extra = {}) {
  return { state, pendingTransports: 0, observedAtMs: NOW, ...extra };
}

function output(bytes) {
  return { capturedBytes: bytes.length, observedBytes: bytes.length, sha256: sha256(bytes), truncated: false };
}

function reportBytes(report) {
  return Buffer.from(`${JSON.stringify(report)}\n`, 'utf8');
}

function rawObservation(report, stderr = Buffer.alloc(0)) {
  const stdout = report === null ? Buffer.alloc(0) : reportBytes(report);
  return { stdoutHex: stdout.toString('hex'), stderrHex: stderr.toString('hex') };
}

function receiptFor(source, report, options = {}) {
  const check = options.check ?? source.check;
  const expected = check.expected;
  const stdout = report === null ? Buffer.alloc(0) : reportBytes(report);
  const stderr = options.stderr ?? Buffer.alloc(0);
  const process = {
    started: true, closed: true, drain: 'CONFIRMED', exitCode: 0, signal: null,
    errorCode: null, deadlineExceeded: false, cancelRequested: false, durationMs: 1,
    ...options.process,
  };
  const resultStatus = options.resultStatus ?? (report === null ? 'ERROR' : report.status);
  const resultReason = options.resultReason ?? (resultStatus === 'PASS' ? '' : resultStatus === 'ERROR' ? 'FIXTURE_ERROR' : 'SWIFT_ARTIFACT_FAILED');
  return {
    schemaVersion: 1,
    expectationFingerprint: expected.fingerprint,
    binding: expected.binding,
    process,
    outputs: { stdout: output(stdout), stderr: output(stderr) },
    result: { status: resultStatus, reason: resultReason },
  };
}

function freshFor(source, report, options = {}) {
  const check = options.check ?? source.check;
  const expected = options.expected ?? check.expected;
  const receipt = options.receipt ?? receiptFor(source, report, options);
  const raw = Object.hasOwn(options, 'rawObservation') ? options.rawObservation : rawObservation(report, options.stderr);
  // Read only trusted fixture identity. A poisoned expectation must reach the
  // production boundary rather than execute inside this helper.
  const executable = check.expected.profile.executableSha256;
  return {
    expected,
    requestSha256: options.requestSha256 ?? check.request.requestSha256,
    path: options.path ?? check.target.path,
    receipt,
    nativeReport: options.nativeReport === undefined ? report : options.nativeReport,
    rawObservation: raw,
    executableBefore: { sha256: options.beforeSha256 ?? executable },
    executableAfter: { sha256: options.afterSha256 ?? executable },
    reservation: options.reservation ?? { acquired: true, released: true, presentRequiresReconciliation: false },
    ownerState: options.ownerState ?? 'IDLE',
    authorizing: false,
  };
}

function sourceReport(source) { return shallow(source.input.priorReport); }

function validFresh(source, options = {}) {
  const report = options.report === undefined ? sourceReport(source) : options.report;
  return freshFor(source, report, options);
}

function assertAuthorityFalse(value) {
  for (const key of [
    'rawContentIncluded', 'persistable', 'executionVerified', 'learningEligible',
    'authorizing', 'nativeExecutionAttested', 'executionGranted',
  ]) if (Object.hasOwn(value, key)) assert.equal(value[key], false, key);
  assert.equal(value.nativeRerun, 'NOT_RUN');
}

function noRaw(value) {
  const text = JSON.stringify(value);
  assert.equal(text.includes('Nisi λ'), false);
  assert.equal(text.includes('sources/'), false);
  assert.equal(text.includes('stdoutHex'), false);
  assert.equal(text.includes('rawObservation'), false);
}

function admit(source, options = {}) {
  return admitNativeIncidentRerunV1({
    plan: options.plan ?? source.plan,
    grant: options.grant ?? grantFrom(source.plan, options.now ?? NOW, options.grantOverrides),
    host: options.host ?? host(),
    now: options.now ?? NOW,
  });
}

function requiresAdmitted(source, options = {}) {
  const result = admit(source, options);
  assert.equal(result.status, 'ADMITTED', `source admission unavailable: ${result.reason}`);
  assert.equal(isIssuedNativeIncidentAdmissionV1(result), true);
  return result;
}

function bind(admission, fresh, now = NOW) {
  return bindNativeIncidentRerunV1({ admission: admission.admission, fresh, now });
}

function assertResultDigest(source, result, report) {
  assert.equal(result.original.priorTranscriptSha256, source.input.priorTranscriptSha256);
  assert.equal(result.original.receiptSha256, source.input.source.receiptSha256);
  assert.equal(result.original.expectationFingerprint, source.input.source.expectationFingerprint);
  assert.equal(result.freshEvidenceOrigin, 'CALLER_SUPPLIED');
  assert.equal(result.fresh.expectationFingerprint, source.check.expected.fingerprint);
  assert.equal(result.fresh.transcriptSha256,
    sha256(`nisi/native-incident-fresh-transcript/v1\0${stable(report?.outcomes ?? null)}`));
  assert.equal(result.evidenceDistinct, true);
  assertAuthorityFalse(result);
  noRaw(result);
}

test('exact issued plan admits one frozen, nonauthorizing original-snapshot handle', async () => {
  const source = await planFor();
  const result = requiresAdmitted(source);
  assert.equal(result.executionGranted, false);
  assert.equal(result.admission.executionProfileSha256, source.identity.profileFingerprint);
  assert.equal(result.admission.executableSha256, source.identity.executableSha256);
  assert.ok(Object.isFrozen(result.admission));
  assertAuthorityFalse(result);
});

test('serialized, spread, reconstructed, and public-hash plans are refused', async () => {
  const source = await planFor();
  for (const plan of [shallow(source.plan), { ...source.plan }, structuredClone(source.plan), { sourcePlanDigest: source.plan.sourcePlanDigest }]) {
    const result = admit(source, { plan });
    assert.equal(result.status, 'REFUSED');
    assert.equal(result.reason, 'SOURCE_PLAN_NOT_ISSUED');
    assertAuthorityFalse(result);
  }
});

test('grant schema, scope, time window, revocation, and host state fail closed', async () => {
  const source = await planFor();
  const cases = [
    [{ scope: 'NATIVE_RERUN_ANYTHING' }, 'GRANT_SCOPE'],
    [{ revoked: true }, 'GRANT_REVOKED'],
    [{ issuedAt: NOW + 1 }, 'GRANT_NOT_YET_VALID'],
    [{ expiresAt: NOW }, 'GRANT_EXPIRED'],
    [{ expiresAt: NOW + 3_600_001 }, 'GRANT_MISMATCH'],
    [{ executableSha256: 'f'.repeat(64) }, 'GRANT_EXECUTABLE_MISMATCH'],
    [{ executionProfileSha256: 'f'.repeat(64) }, 'GRANT_EXECUTION_PROFILE_MISMATCH'],
  ];
  for (const [overrides, code] of cases) {
    const result = admit(source, { grantOverrides: overrides });
    assert.equal(result.reason, code, code);
    assertAuthorityFalse(result);
  }
  for (const [observed, code] of [
    [host('BUSY'), 'HOST_NOT_IDLE'],
    [host('IDLE', { observedAtMs: NOW - 5000 }), 'HOST_STALE'],
    [host('IDLE', { observedAtMs: NOW + 1 }), 'HOST_FUTURE'],
    [host('IDLE', { pendingTransports: 1 }), 'TRANSPORTS_PENDING'],
    [host('OFF', { pendingTransports: 1 }), 'DRAIN_UNCONFIRMED'],
    [host('IDLE', { observedAtMs: -0 }), 'HOST_SCHEMA'],
    [host('IDLE', { pendingTransports: -0 }), 'HOST_SCHEMA'],
  ]) {
    const result = admit(source, { host: observed });
    assert.equal(result.reason, code, code);
    assertAuthorityFalse(result);
  }
});

test('identity accessor and private input bind exact source, profile, and executable identities', async () => {
  const source = await planFor();
  const input = source.input;
  assert.equal(input.source.expectationFingerprint, source.identity.expectationFingerprint);
  assert.equal(source.identity.authorizing, false);
  assert.equal(source.identity.profileFingerprint, source.check.expected.binding.profileFingerprint);
  assert.equal(source.identity.executableSha256, source.check.expected.profile.executableSha256);
  assert.equal(source.check.expected.binding.preparationFingerprint, input.source.preparationFingerprint);
  assert.equal(source.check.expected.binding.materializedFingerprint, input.source.materializedFingerprint);
  assert.equal(input.artifact.relativePath, source.check.target.path);
  assert.equal(input.artifact.sha256, source.check.target.artifactSha256);
  assert.equal(input.artifact.byteLength, source.check.target.artifactByteLength);
  assert.ok(Object.isFrozen(input));
  assert.ok(Object.isFrozen(source.identity));
});

test('admission and binding preserve original identities and do not expose source material', async () => {
  const source = await planFor();
  const admission = requiresAdmitted(source);
  const report = sourceReport(source);
  const result = bind(admission, validFresh(source, { report }));
  assert.equal(result.status, 'MATCHED');
  assertResultDigest(source, result, report);
});

test('MATCHED and DIVERGED require the original request, selected file, and fixed outcome inventory', async () => {
  const source = await planFor();
  const report = sourceReport(source);
  const matched = bind(requiresAdmitted(source), validFresh(source, { report }));
  assert.equal(matched.status, 'MATCHED');
  assertResultDigest(source, matched, report);
  const divergedReport = shallow(report);
  divergedReport.outcomes = report.outcomes.map((row, index) => index === 2
    ? { ...row, status: row.status === 'PASS' ? 'FAIL' : 'PASS' } : { ...row });
  divergedReport.status = 'PASS';
  const diverged = bind(requiresAdmitted(source), validFresh(source, { report: divergedReport }));
  assert.equal(diverged.status, 'DIVERGED');
  assert.equal(diverged.reason, 'OUTCOMES_DIFFER');
  assertResultDigest(source, diverged, divergedReport);
  assert.notEqual(matched.fresh.transcriptSha256, diverged.fresh.transcriptSha256);
});

test('wrong check, executable, request, artifact, owner, and report identities never promote evidence', async () => {
  const source = await planFor();
  const report = sourceReport(source);
  const cases = [
    [value => ({ ...value, path: 'sources/other.txt' }), 'FRESH_PATH_MISMATCH'],
    [value => ({ ...value, requestSha256: 'f'.repeat(64) }), 'NATIVE_REPORT_MISMATCH'],
    [value => ({ ...value, executableBefore: { sha256: 'f'.repeat(64) } }), 'EXECUTABLE_MISMATCH'],
    [value => ({ ...value, reservation: { acquired: true, released: false, presentRequiresReconciliation: true } }), 'RESERVATION_UNRECONCILED'],
    [value => ({ ...value, ownerState: 'QUARANTINED' }), 'OWNER_QUARANTINED'],
    [value => ({ ...value, expected: source.checks[0].expected }), 'FRESH_RECEIPT_INVALID'],
  ];
  for (const [mutate, reason] of cases) {
    const result = bind(requiresAdmitted(source), mutate(validFresh(source, { report })));
    assert.equal(result.status, 'REFUSED', reason);
    assert.equal(result.reason, reason, reason);
    assertAuthorityFalse(result);
  }
  const badReport = { ...report, requestSha256: 'f'.repeat(64) };
  const bad = bind(requiresAdmitted(source), validFresh(source, { report: badReport }));
  assert.equal(bad.reason, 'NATIVE_REPORT_MISMATCH');
});

test('receipt is checked before expectation traversal and report/outcome records are inert exact data', async () => {
  const source = await planFor();
  const report = sourceReport(source);
  let reads = 0;
  const expectationProxy = new Proxy(source.check.expected, { get() { reads += 1; throw Error('MUST_NOT_READ_EXPECTATION'); } });
  const revoked = Proxy.revocable(source.check.expected, {});
  revoked.revoke();
  for (const poisoned of [expectationProxy, revoked.proxy]) {
    const result = bind(requiresAdmitted(source), validFresh(source, { report, expected: poisoned }));
    assert.equal(result.reason, 'FRESH_RECEIPT_INVALID');
    assert.equal(reads, 0);
  }
  const reportAccessor = Object.defineProperty({ ...report }, 'outcomes', {
    enumerable: true, configurable: true, get() { reads += 1; throw Error('MUST_NOT_READ_OUTCOMES'); },
  });
  const reportProxy = new Proxy(report, { ownKeys() { reads += 1; throw Error('MUST_NOT_REFLECT_REPORT'); } });
  for (const malformed of [reportAccessor, reportProxy]) {
    const result = bind(requiresAdmitted(source), validFresh(source, {
      report,
      nativeReport: malformed,
      rawObservation: rawObservation(report),
    }));
    assert.equal(result.reason, 'NATIVE_REPORT_SCHEMA');
  }
  assert.equal(reads, 0);
});

test('all receipt graph accessors, proxies, and revoked proxies are refused with zero traps', async () => {
  const source = await planFor();
  const report = sourceReport(source);
  const base = validFresh(source, { report });
  const positions = ['top', 'binding', 'process', 'outputs', 'stdout', 'stderr', 'result'];
  const wrap = (receipt, position) => {
    const trapped = { count: 0 };
    const proxy = target => new Proxy(target, {
      get() { trapped.count += 1; throw Error('MUST_NOT_GET_RECEIPT'); },
      ownKeys() { trapped.count += 1; throw Error('MUST_NOT_KEYS_RECEIPT'); },
      getOwnPropertyDescriptor() { trapped.count += 1; throw Error('MUST_NOT_DESCRIPTOR_RECEIPT'); },
      getPrototypeOf() { trapped.count += 1; throw Error('MUST_NOT_PROTO_RECEIPT'); },
    });
    if (position === 'top') return { value: proxy(receipt), trapped };
    if (position === 'binding') return { value: { ...receipt, binding: proxy(receipt.binding) }, trapped };
    if (position === 'process') return { value: { ...receipt, process: proxy(receipt.process) }, trapped };
    if (position === 'outputs') return { value: { ...receipt, outputs: proxy(receipt.outputs) }, trapped };
    if (position === 'stdout') return { value: { ...receipt, outputs: { ...receipt.outputs, stdout: proxy(receipt.outputs.stdout) } }, trapped };
    if (position === 'stderr') return { value: { ...receipt, outputs: { ...receipt.outputs, stderr: proxy(receipt.outputs.stderr) } }, trapped };
    return { value: { ...receipt, result: proxy(receipt.result) }, trapped };
  };
  for (const position of positions) {
    const wrapped = wrap(base.receipt, position);
    const result = bind(requiresAdmitted(source), { ...base, receipt: wrapped.value });
    assert.equal(result.reason, 'FRESH_RECEIPT_INVALID', position);
    assert.equal(wrapped.trapped.count, 0, position);
    assertAuthorityFalse(result);
  }
  for (const position of positions) {
    const target = position === 'top' ? base.receipt : position === 'binding' ? base.receipt.binding :
      position === 'process' ? base.receipt.process : position === 'outputs' ? base.receipt.outputs :
        position === 'stdout' ? base.receipt.outputs.stdout : position === 'stderr' ? base.receipt.outputs.stderr : base.receipt.result;
    const revoked = Proxy.revocable(target, {});
    revoked.revoke();
    const wrapped = position === 'top' ? revoked.proxy : position === 'binding' ? { ...base.receipt, binding: revoked.proxy } :
      position === 'process' ? { ...base.receipt, process: revoked.proxy } : position === 'outputs' ? { ...base.receipt, outputs: revoked.proxy } :
        position === 'stdout' ? { ...base.receipt, outputs: { ...base.receipt.outputs, stdout: revoked.proxy } } :
          position === 'stderr' ? { ...base.receipt, outputs: { ...base.receipt.outputs, stderr: revoked.proxy } } :
            { ...base.receipt, result: revoked.proxy };
    const result = bind(requiresAdmitted(source), { ...base, receipt: wrapped });
    assert.equal(result.reason, 'FRESH_RECEIPT_INVALID', `revoked ${position}`);
    assertAuthorityFalse(result);
  }
  for (const position of positions) {
    const receipt = shallow(base.receipt);
    const target = position === 'top' ? receipt : position === 'stdout' || position === 'stderr' ? receipt.outputs[position] : receipt[position];
    let reads = 0;
    Object.defineProperty(target, Object.keys(target)[0], { enumerable: true, configurable: true,
      get() { reads += 1; throw Error('MUST_NOT_READ_RECEIPT_ACCESSOR'); } });
    const result = bind(requiresAdmitted(source), { ...base, receipt });
    assert.equal(result.reason, 'FRESH_RECEIPT_INVALID', `accessor ${position}`);
    assert.equal(reads, 0, position);
  }
});

test('raw observation is exact, request-bound, and cannot be replaced by a proxy or digest mismatch', async () => {
  const source = await planFor();
  const report = sourceReport(source);
  const valid = validFresh(source, { report });
  const matched = bind(requiresAdmitted(source), valid);
  assert.equal(matched.status, 'MATCHED');
  for (const [mutate, reason] of [
    [value => ({ ...value, rawObservation: { stdoutHex: '00', stderrHex: value.rawObservation.stderrHex } }), 'FRESH_OBSERVATION_MISMATCH'],
    [value => ({ ...value, rawObservation: { stdoutHex: value.rawObservation.stdoutHex, stderrHex: '00' } }), 'FRESH_OBSERVATION_MISMATCH'],
    [value => ({ ...value, rawObservation: { stdoutHex: value.rawObservation.stdoutHex.toUpperCase(), stderrHex: value.rawObservation.stderrHex } }), 'FRESH_OBSERVATION_SCHEMA'],
    [value => ({ ...value, rawObservation: new Proxy(value.rawObservation, { get() { throw Error('RAW_TRAP'); } }) }), 'FRESH_OBSERVATION_SCHEMA'],
  ]) {
    const result = bind(requiresAdmitted(source), mutate(validFresh(source, { report })));
    assert.equal(result.status, 'REFUSED');
    assert.equal(result.reason, reason);
    assertAuthorityFalse(result);
  }
});

test('cancel, unknown drain, receipt error, and missing report remain adverse and nonpromoting', async () => {
  const source = await planFor();
  const cases = [
    [{ process: { cancelRequested: true }, resultStatus: 'INCONCLUSIVE', resultReason: 'ABORTED' }, 'INTERRUPTED', 'RERUN_CANCELLED', sourceReport(source)],
    [{ process: { drain: 'UNKNOWN' }, resultStatus: 'INCONCLUSIVE', resultReason: 'DRAIN_UNCONFIRMED' }, 'INCONCLUSIVE', 'DRAIN_UNCONFIRMED', sourceReport(source)],
    [{ resultStatus: 'ERROR', resultReason: 'FIXTURE_ERROR', process: { errorCode: 'FIXTURE_ERROR' } }, 'ERROR', 'FIXTURE_ERROR', null],
  ];
  for (const [options, status, reason, report] of cases) {
    const result = bind(requiresAdmitted(source), validFresh(source, {
      report, nativeReport: report, ...options,
    }));
    assert.equal(result.status, status);
    assert.equal(result.reason, reason);
    assert.equal(result.original, null);
    assert.equal(result.fresh, null);
    assertAuthorityFalse(result);
  }
});

test('handle is single-use; malformed, expired, reverse-clock, copied, and wrong-instance calls have no authority', async () => {
  const source = await planFor();
  const admission = requiresAdmitted(source);
  const copy = { ...admission.admission };
  const copied = bindNativeIncidentRerunV1({ admission: copy, fresh: {}, now: NOW });
  assert.equal(copied.reason, 'ADMISSION_NOT_ISSUED');
  const malformed = bind(admission, validFresh(source, { rawObservation: null }));
  assert.equal(malformed.reason, 'FRESH_OBSERVATION_SCHEMA');
  const consumed = bind(admission, validFresh(source));
  assert.equal(consumed.reason, 'ADMISSION_CONSUMED');
  const expired = requiresAdmitted(source);
  const expiredResult = bind(expired, validFresh(source), NOW + 900_000);
  assert.equal(expiredResult.reason, 'ADMISSION_EXPIRED');
  assert.equal(bind(expired, validFresh(source)).reason, 'ADMISSION_CONSUMED');
  const reversed = requiresAdmitted(source);
  const reverseResult = bind(reversed, validFresh(source), NOW - 1);
  assert.equal(reverseResult.reason, 'ADMISSION_CLOCK_REVERSED');
  assert.equal(bind(reversed, validFresh(source)).reason, 'ADMISSION_CONSUMED');
  assert.equal(bind(requiresAdmitted(source), validFresh(source), -0).reason, 'INVALID_CLOCK');
  assert.equal(admit(source, { now: -0 }).reason, 'INVALID_CLOCK');
  const wrong = requiresAdmitted(source);
  const wrongCheckFresh = validFresh(source, { check: source.checks[0], report: sourceReport(source) });
  const wrongExpected = {
    ...wrongCheckFresh,
    expected: source.checks[0].expected,
    requestSha256: source.check.request.requestSha256,
    path: source.check.target.path,
    nativeReport: sourceReport(source),
    rawObservation: rawObservation(sourceReport(source)),
  };
  const wrongResult = bind(wrong, wrongExpected);
  assert.equal(wrongResult.reason, 'FRESH_EXPECTATION_MISMATCH');
});

test('null-prototype data records are accepted without granting authority', async () => {
  const source = await planFor();
  const report = sourceReport(source);
  const value = validFresh(source, { report });
  const nullRecord = record => Object.assign(Object.create(null), record);
  const nullFresh = {
    ...value,
    executableBefore: nullRecord(value.executableBefore),
    executableAfter: nullRecord(value.executableAfter),
    reservation: nullRecord(value.reservation),
    rawObservation: nullRecord(value.rawObservation),
  };
  const result = bind(requiresAdmitted(source), nullFresh);
  assert.equal(result.status, 'MATCHED');
  assertResultDigest(source, result, report);
});

test('normalized admission and refusal records are exact authority-free shapes', async () => {
  const source = await planFor();
  const result = admit(source);
  assert.deepEqual(Object.keys(result).sort(), [
    'admission', 'authorizing', 'checks', 'executionGranted', 'executionVerified',
    'grantDigest', 'learningEligible', 'nativeRerun', 'persistable', 'reason',
    'schemaVersion', 'sourcePlanDigest', 'status',
  ].sort());
  assert.equal(Object.isFrozen(result), true);
  noRaw(result);
  assert.equal(Object.hasOwn(result, 'journal'), false);
  assert.equal(Object.hasOwn(result, 'store'), false);
});
