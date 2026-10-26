// C07 isolated integration oracle.  Intended target is the work-order clone,
// not the canonical repository.  It uses only issued synthetic fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { admitNativeIncidentRerunV1, bindNativeIncidentRerunV1,
  isIssuedNativeIncidentAdmissionV1 } from '../../../hosts/repository/native-incident-admission-v1.mjs';
import { createBoundaryNativeIncidentFixture } from '../../../tests/helpers/native-incident-source-fixture.mjs';
import { readNativeIncidentSourceInputV1, readNativeIncidentExecutionIdentityV1 } from '../../../hosts/repository/native-incident-source-v1.mjs';
import { issuedSwiftChecksV1 } from '../../../hosts/swift-verifier/check-plan-v1.mjs';
import { entry } from '../../../tests/helpers/swift-group-fixture.mjs';

const NOW = 10_000;
const HEX = '3'.repeat(64);
const shallow = value => JSON.parse(JSON.stringify(value));
const planFor = async t => {
  const f = await createBoundaryNativeIncidentFixture(t);
  const preview = f.host.incidentPreview();
  for (const row of preview.rows) {
    if (row.classification !== 'FAILURE_CANDIDATE') continue;
    const plan = f.host.nativeIncidentSourcePlan({ rowId: row.rowId });
    if (plan.status !== 'SOURCE_BOUND' || plan.selection.artifactByteLength === 0) continue;
    const input = readNativeIncidentSourceInputV1({ plan });
    const original = f.plans.find(value => value.fingerprint === row.source.planFingerprint);
    const index = row.binding.checkIndex;
    const checks = issuedSwiftChecksV1(original);
    return { f, row, plan, input, original, index, checks, check: checks[index] };
  }
  assert.fail('no issued source-bound boundary row');
};

function grantFrom(sourcePlan, now = NOW, overrides = {}) {
  const selection = sourcePlan.selection;
  const identity = readNativeIncidentExecutionIdentityV1({ plan: sourcePlan });
  return { schemaVersion: 'nisi-native-incident-rerun-grant/v1', grantId: 'native-grant-c07', sourcePlanDigest: sourcePlan.sourcePlanDigest,
    inputSha256: selection.inputSha256, rowId: selection.rowId, previewSha256: selection.previewSha256,
    executionProfileSha256: identity.profileFingerprint, executableSha256: identity.executableSha256,
    issuedAt: now - 100, expiresAt: now + 900_000, revoked: false,
    scope: 'NATIVE_RERUN_ORIGINAL_SNAPSHOT_ONLY', rawContentPersisted: false, networkEgress: false,
    learningInfluence: false, ...overrides };
}
function host(state = 'IDLE', extra = {}) { return { state, pendingTransports: 0, observedAtMs: NOW, ...extra }; }
function fresh(check, report, options = {}) {
  const expected = check.expected;
  const hash = expected.profile.executableSha256;
  const receipt = report.receipt;
  return { expected, requestSha256: check.request.requestSha256, path: check.target.path,
    receipt, nativeReport: report.nativeReport, rawObservation: report.rawObservation ?? null,
    executableBefore: { sha256: hash }, executableAfter: { sha256: hash },
    reservation: { acquired: true, released: true, presentRequiresReconciliation: false },
    ownerState: 'IDLE', authorizing: false, ...options };
}
function noRaw(value) {
  const text = JSON.stringify(value);
  assert.equal(text.includes('Nisi λ'), false);
  assert.equal(text.includes('sources/'), false);
  assert.equal(text.includes('stdoutHex'), false);
  assert.equal(text.includes('rawObservation'), false);
}
function assertAuthorityFalse(value) {
  for (const key of ['rawContentIncluded', 'persistable', 'executionVerified', 'learningEligible',
    'authorizing', 'nativeExecutionAttested']) {
    if (Object.hasOwn(value, key)) assert.equal(value[key], false, key);
  }
  assert.equal(value.nativeRerun, 'NOT_RUN');
}
function requiresAdmitted(source) {
  const result = admitNativeIncidentRerunV1({ plan: source.plan, grant: grantFrom(source.plan), host: host(), now: NOW });
  assert.equal(result.status, 'ADMITTED', `source admission unavailable: ${result.reason}`);
  return result;
}

test('exact issued plan admits a single nonauthorizing original-snapshot handle', async t => {
  const source = await planFor(t);
  // This test is completed by the staged source-plan selection fixture; no
  // public clone or hand-built selection is accepted as an issued plan.
  const sourcePlan = source.plan;
  const result = admitNativeIncidentRerunV1({ plan: sourcePlan, grant: grantFrom(sourcePlan), host: host() , now: NOW });
  assert.equal(result.status, 'ADMITTED');
  assert.equal(isIssuedNativeIncidentAdmissionV1(result), true);
  assert.equal(result.executionGranted, false);
  assertAuthorityFalse(result);
  assert.ok(Object.isFrozen(result.admission));
});

test('serialized, spread, reconstructed, and public-hash plans are refused', async t => {
  const source = await planFor(t);
  for (const plan of [shallow(source.plan), { ...source.plan }, structuredClone(source.plan),
    { sourcePlanDigest: source.plan.sourcePlanDigest }]) {
    const result = admitNativeIncidentRerunV1({ plan, grant: grantFrom(source.plan), host: host(), now: NOW });
    assert.equal(result.status, 'REFUSED');
    assert.equal(result.reason, 'SOURCE_PLAN_NOT_ISSUED');
    assertAuthorityFalse(result);
  }
});

test('grant schema, scope, time window, revocation, and host state fail closed', async t => {
  const source = await planFor(t);
  const cases = [
    [{ scope: 'NATIVE_RERUN_ANYTHING' }, 'GRANT_SCOPE'],
    [{ revoked: true }, 'GRANT_REVOKED'],
    [{ issuedAt: NOW + 1 }, 'GRANT_NOT_YET_VALID'],
    [{ expiresAt: NOW }, 'GRANT_EXPIRED'],
    [{ expiresAt: NOW + 3_600_001 }, 'GRANT_MISMATCH'],
    [{ executableSha256: 'f'.repeat(64) }, 'GRANT_EXECUTABLE_MISMATCH'],
  ];
  for (const [overrides, code] of cases) {
    const result = admitNativeIncidentRerunV1({ plan: source.plan, grant: grantFrom(source.plan, NOW, overrides), host: host(), now: NOW });
    assert.equal(result.reason, code);
    assertAuthorityFalse(result);
  }
  for (const [observed, code] of [[host('BUSY'), 'HOST_NOT_IDLE'], [host('IDLE', { observedAtMs: NOW - 5000 }), 'HOST_STALE'],
    [host('IDLE', { observedAtMs: NOW + 1 }), 'HOST_FUTURE'],
    [host('IDLE', { pendingTransports: 1 }), 'TRANSPORTS_PENDING'], [host('OFF', { pendingTransports: 1 }), 'DRAIN_UNCONFIRMED']]) {
    const result = admitNativeIncidentRerunV1({ plan: source.plan, grant: grantFrom(source.plan), host: observed, now: NOW });
    assert.equal(result.reason, code);
    assertAuthorityFalse(result);
  }
});

test('admission and binding preserve original issued identities and do not expose source material', async t => {
  const source = await planFor(t);
  const admission = requiresAdmitted(source);
  assert.equal(admission.status, 'ADMITTED');
  const check = source.check;
  const report = entry(source.plan, source.checks.indexOf(check), 'FAIL');
  const result = bindNativeIncidentRerunV1({ admission: admission.admission, fresh: fresh(check, {
    receipt: report.receipt, nativeReport: JSON.parse(Buffer.from(report.stdoutHex, 'hex').toString('utf8')), rawObservation: null }), now: NOW });
  assert.equal(result.status, 'MATCHED');
  assert.equal(result.evidenceDistinct, true);
  assertAuthorityFalse(result);
  noRaw(result);
});

test('wrong check, executable, request, artifact, and owner identities never promote evidence', async t => {
  const source = await planFor(t);
  const check = source.checks[0];
  const report = entry(source.plan, 0, 'FAIL');
  for (const [mutate, reason] of [
    [value => ({ ...value, path: 'sources/other.txt' }), 'FRESH_PATH_MISMATCH'],
    [value => ({ ...value, requestSha256: 'f'.repeat(64) }), 'NATIVE_REPORT_MISMATCH'],
    [value => ({ ...value, executableBefore: { sha256: 'f'.repeat(64) } }), 'EXECUTABLE_MISMATCH'],
    [value => ({ ...value, reservation: { acquired: true, released: false, presentRequiresReconciliation: true } }), 'RESERVATION_UNRECONCILED'],
    [value => ({ ...value, ownerState: 'QUARANTINED' }), 'OWNER_QUARANTINED'],
  ]) {
    const admission = requiresAdmitted(source);
    const result = bindNativeIncidentRerunV1({ admission: admission.admission, fresh: mutate(fresh(check, {
      receipt: report.receipt, nativeReport: JSON.parse(Buffer.from(report.stdoutHex, 'hex').toString('utf8')) })), now: NOW });
    assert.equal(result.status, 'REFUSED');
    assert.equal(result.reason, reason);
    assertAuthorityFalse(result);
  }
});

test('receipt is checked before caller expectation traversal and report/outcome records are proxy-free exact data', async t => {
  const source = await planFor(t);
  const check = source.check;
  const report = entry(source.plan, source.index, 'FAIL');
  const native = JSON.parse(Buffer.from(report.stdoutHex, 'hex').toString('utf8'));
  let reads = 0;
  const expectationProxy = new Proxy(check.expected, { get() { reads += 1; throw Error('MUST_NOT_READ_EXPECTATION'); } });
  const revoked = Proxy.revocable(check.expected, {}); revoked.revoke();
  for (const poisoned of [expectationProxy, revoked.proxy]) {
    const admission = requiresAdmitted(source);
    const result = bindNativeIncidentRerunV1({ admission: admission.admission, fresh: fresh(check, {
      receipt: report.receipt, nativeReport: native, expected: poisoned }), now: NOW });
    assert.equal(result.reason, 'FRESH_RECEIPT_INVALID');
    assert.equal(reads, 0);
  }
  const reportAccessor = Object.defineProperty({ ...native }, 'outcomes', {
    enumerable: true, configurable: true, get() { reads += 1; throw Error('MUST_NOT_READ_OUTCOMES'); }
  });
  const reportProxy = new Proxy(native, { ownKeys() { reads += 1; throw Error('MUST_NOT_REFLECT_REPORT'); } });
  for (const malformed of [reportAccessor, reportProxy]) {
    const admission = requiresAdmitted(source);
    const result = bindNativeIncidentRerunV1({ admission: admission.admission, fresh: fresh(check, {
      receipt: report.receipt, nativeReport: malformed }), now: NOW });
    assert.equal(result.reason, 'NATIVE_REPORT_SCHEMA');
  }
  const hidden = { ...native, outcomes: native.outcomes.map(row => ({ ...row, hidden: true })) };
  const admission = requiresAdmitted(source);
  const result = bindNativeIncidentRerunV1({ admission: admission.admission, fresh: fresh(check, {
    receipt: report.receipt, nativeReport: hidden }), now: NOW });
  assert.equal(result.reason, 'NATIVE_REPORT_SCHEMA');
  assert.equal(reads, 0);
});

test('top-level and every nested receipt proxy are refused before any trap or execution path', async t => {
  const source = await planFor(t), check = source.check, report = entry(source.plan, source.index, 'FAIL');
  const native = JSON.parse(Buffer.from(report.stdoutHex, 'hex').toString('utf8'));
  const base = fresh(check, { receipt: report.receipt, nativeReport: native });
  const positions = ['top', 'binding', 'process', 'outputs', 'stdout', 'stderr', 'result'];
  const wrap = (receipt, position) => {
    const trapped = { count: 0 };
    const proxy = target => new Proxy(target, {
      get() { trapped.count += 1; throw Error('MUST_NOT_GET_RECEIPT'); },
      ownKeys() { trapped.count += 1; throw Error('MUST_NOT_KEYS_RECEIPT'); },
      getOwnPropertyDescriptor() { trapped.count += 1; throw Error('MUST_NOT_DESCRIPTOR_RECEIPT'); },
      getPrototypeOf() { trapped.count += 1; throw Error('MUST_NOT_PROTO_RECEIPT'); }
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
    const admission = requiresAdmitted(source);
    const result = bindNativeIncidentRerunV1({ admission: admission.admission,
      fresh: { ...base, receipt: wrapped.value }, now: NOW });
    assert.equal(result.status, 'REFUSED', position);
    assert.equal(result.reason, 'FRESH_RECEIPT_INVALID', position);
    assert.equal(wrapped.trapped.count, 0, position);
    assertAuthorityFalse(result);
  }
  for (const position of positions) {
    let target;
    if (position === 'top') target = base.receipt;
    else if (position === 'binding') target = base.receipt.binding;
    else if (position === 'process') target = base.receipt.process;
    else if (position === 'outputs') target = base.receipt.outputs;
    else if (position === 'stdout') target = base.receipt.outputs.stdout;
    else if (position === 'stderr') target = base.receipt.outputs.stderr;
    else target = base.receipt.result;
    const revoked = Proxy.revocable(target, {}); revoked.revoke();
    const wrapped = position === 'top' ? revoked.proxy : position === 'binding' ? { ...base.receipt, binding: revoked.proxy } :
      position === 'process' ? { ...base.receipt, process: revoked.proxy } : position === 'outputs' ? { ...base.receipt, outputs: revoked.proxy } :
      position === 'stdout' ? { ...base.receipt, outputs: { ...base.receipt.outputs, stdout: revoked.proxy } } :
      position === 'stderr' ? { ...base.receipt, outputs: { ...base.receipt.outputs, stderr: revoked.proxy } } :
      { ...base.receipt, result: revoked.proxy };
    const admission = requiresAdmitted(source);
    const result = bindNativeIncidentRerunV1({ admission: admission.admission,
      fresh: { ...base, receipt: wrapped }, now: NOW });
    assert.equal(result.reason, 'FRESH_RECEIPT_INVALID', `revoked ${position}`);
    assertAuthorityFalse(result);
  }
});

test('cancel, unknown drain, receipt error, missing report, and unreconciled reservation remain adverse', async t => {
  const source = await planFor(t);
  const check = source.checks[0];
  for (const [process, expected] of [
    [{ cancelRequested: true }, 'INTERRUPTED'],
    [{ drain: 'UNKNOWN' }, 'INCONCLUSIVE'],
    [{ errorCode: 'FIXTURE_ERROR' }, 'ERROR'],
  ]) {
    const admission = requiresAdmitted(source);
    const report = entry(source.plan, 0, expected === 'ERROR' ? 'ERROR' : 'FAIL', { process });
    const result = bindNativeIncidentRerunV1({ admission: admission.admission, fresh: fresh(check, {
      receipt: report.receipt, nativeReport: expected === 'ERROR' ? null : JSON.parse(Buffer.from(report.stdoutHex, 'hex').toString('utf8')) }) , now: NOW });
    assert.equal(result.status, expected);
    assert.equal(result.original, null);
    assertAuthorityFalse(result);
  }
});

test('handle is single use, expires independently, and copied handles have no authority', async t => {
  const source = await planFor(t);
  const admission = requiresAdmitted(source);
  const copy = { ...admission.admission };
  const copied = bindNativeIncidentRerunV1({ admission: copy, fresh: {}, now: NOW });
  assert.equal(copied.reason, 'ADMISSION_NOT_ISSUED');
  const check = source.checks[0], report = entry(source.plan, 0, 'FAIL');
  const first = bindNativeIncidentRerunV1({ admission: admission.admission, fresh: fresh(check, {
    receipt: report.receipt, nativeReport: JSON.parse(Buffer.from(report.stdoutHex, 'hex').toString('utf8')) }), now: NOW });
  assert.equal(first.status, 'MATCHED');
  const second = bindNativeIncidentRerunV1({ admission: admission.admission, fresh: {}, now: NOW });
  assert.equal(second.reason, 'ADMISSION_CONSUMED');
  assertAuthorityFalse(second);
});

test('normalized records have exact authority-free shape and no persistence channel', async t => {
  const source = await planFor(t);
  const result = admitNativeIncidentRerunV1({ plan: source.plan, grant: grantFrom(source.plan), host: host(), now: NOW });
  assert.deepEqual(Object.keys(result).sort(), ['admission', 'authorizing', 'checks', 'executionGranted', 'executionVerified',
    'grantDigest', 'learningEligible', 'nativeRerun', 'persistable', 'reason', 'schemaVersion', 'sourcePlanDigest', 'status'].sort());
  assert.equal(Object.isFrozen(result), true);
  noRaw(result);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'journal'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'store'), false);
});
