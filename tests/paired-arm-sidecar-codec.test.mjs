import test from 'node:test';
import assert from 'node:assert/strict';
import { pairedArmContext } from './helpers/paired-arm-owner-fixture.mjs';
import {
  armSidecarDigestV1,
  projectArmAdmissionV1,
  projectArmProjectionV1,
  readArmSidecarRecordV1,
  encodeArmSidecarRecordV1,
  decodeArmSidecarRecordV1,
} from '../history/paired-arm-sidecar-codec-v1.mjs';
import { stableStringify, sha256Text } from '../workflow/contracts.mjs';

const D = '0'.repeat(64);
const clone = value => JSON.parse(JSON.stringify(value));
const invalid = fn => assert.throws(fn, { code: 'ARM_SIDECAR_INVALID' });
const fingerprint = (domain, value) => {
  const body = clone(value);
  delete body.fingerprint;
  body.fingerprint = sha256Text(domain + '\0' + stableStringify(body));
  return body;
};
const admissionFingerprint = value => fingerprint('nisi/scheduled-arm-admission/v1', value);
const projectionFingerprint = value => fingerprint('nisi/repository-trial-projection/v2', value);
const main = sequence => ({ sequence, sha256: sha256Text('test/main-event\0' + sequence) });

test('sidecar codec accepts only original arm-owner producer shapes and round-trips its chain', async t => {
  const c = await pairedArmContext(t);
  const ledger = await c.runner.run();
  assert.equal(ledger.counts.completed, 1);

  const preparedRaw = c.state.admissions.find(row =>
    row.schemaVersion === 'nisi-scheduled-arm-admission-v1' && row.phase === 'EXECUTOR');
  const historyRaw = c.state.admissions.find(row =>
    row.schemaVersion === 'nisi-scheduled-arm-admission-history-v1' &&
    row.disposition === 'POST_PHASE_LOCAL_OBSERVATIONS');
  const view = c.owner.inspect();
  const projectionRaw = view.rows[0].projection;
  assert(preparedRaw); assert(historyRaw); assert(projectionRaw);

  const prepared = projectArmAdmissionV1(preparedRaw, main(1));
  const history = projectArmAdmissionV1(historyRaw, main(2), c.approval);
  const projection = projectArmProjectionV1(projectionRaw);
  assert.equal(prepared.kind, 'PREPARED');
  assert.equal(prepared.phase, 'EXECUTOR');
  assert.equal(prepared.producerFingerprint, preparedRaw.fingerprint);
  assert.equal(prepared.intentSha256, armSidecarDigestV1(preparedRaw.intent));
  assert.equal(history.kind, 'HISTORY');
  assert.equal(history.producerFingerprint, historyRaw.fingerprint);
  assert.equal(history.entries.length, 2);
  assert.equal(projection.fingerprint, projectionRaw.fingerprint);
  assert.equal(projection.candidate.candidateSha256, projectionRaw.candidate.candidateSha256);
  assert.equal(Object.hasOwn(projection, 'intent'), false);
  assert.equal(Object.hasOwn(projection, 'inputs'), false);
  assert.equal(stableStringify(projection).includes('candidateText'), false);

  const header = readArmSidecarRecordV1({ kind: 'HEADER', main: main(0),
    runnerId: view.runnerId, planSha256: c.plan.planSha256,
    profileSha256: c.profile.profileSha256,
    intentsSha256: armSidecarDigestV1(c.state.events[0].intents) });
  const encodedHeader = encodeArmSidecarRecordV1(header, 0, null);
  const encodedPrepared = encodeArmSidecarRecordV1(prepared, 1, encodedHeader.sha256);
  assert.deepEqual(decodeArmSidecarRecordV1(encodedHeader.bytes, 0, null), encodedHeader);
  assert.deepEqual(decodeArmSidecarRecordV1(
    encodedPrepared.bytes, 1, encodedHeader.sha256), encodedPrepared);

  const corrupted = Buffer.from(encodedPrepared.bytes);
  const at = corrupted.indexOf(Buffer.from(encodedPrepared.sha256));
  assert(at >= 0); corrupted[at] = corrupted[at] === 0x30 ? 0x31 : 0x30;
  invalid(() => decodeArmSidecarRecordV1(corrupted, 1, encodedHeader.sha256));
  invalid(() => decodeArmSidecarRecordV1(encodedPrepared.bytes, 1, D));

  await t.test('closed original admission and history schemas reject recomputed hybrids', () => {
    const admissionExtra = clone(preparedRaw);
    admissionExtra.unreviewed = false;
    invalid(() => projectArmAdmissionV1(admissionFingerprint(admissionExtra), main(1)));

    const historyHybrid = clone(historyRaw);
    historyHybrid.phase = 'EXECUTOR';
    historyHybrid.observation = preparedRaw.observation;
    invalid(() => projectArmAdmissionV1(admissionFingerprint(historyHybrid), main(2), c.approval));

    const historyMissing = clone(historyRaw);
    delete historyMissing.sourceTrust;
    invalid(() => projectArmAdmissionV1(admissionFingerprint(historyMissing), main(2), c.approval));
  });

  await t.test('closed V2 producer rejects omitted discarded data and unknown data', () => {
    const omitted = clone(projectionRaw);
    delete omitted.repositoryReceiptReasons;
    invalid(() => projectArmProjectionV1(projectionFingerprint(omitted)));

    const extra = clone(projectionRaw);
    extra.unreviewedProviderDetail = 'not retained';
    invalid(() => projectArmProjectionV1(projectionFingerprint(extra)));
  });

  await t.test('terminal labels are non-null and from the current producer contracts', () => {
    for (const key of ['repositoryReceiptStatus', 'engineOutcome', 'workflowOutcome']) {
      const missing = clone(projectionRaw);
      missing[key] = null;
      invalid(() => projectArmProjectionV1(projectionFingerprint(missing)));
      const unknown = clone(projectionRaw);
      unknown[key] = 'UNKNOWN_FUTURE_LABEL';
      invalid(() => projectArmProjectionV1(projectionFingerprint(unknown)));
    }
  });

  await t.test('proxy and getter inputs refuse without invoking traps', () => {
    let traps = 0;
    const proxy = new Proxy(preparedRaw, {
      get() { traps++; throw new Error('get trap'); },
      ownKeys() { traps++; throw new Error('ownKeys trap'); },
      getOwnPropertyDescriptor() { traps++; throw new Error('descriptor trap'); },
    });
    invalid(() => projectArmAdmissionV1(proxy, main(1)));
    assert.equal(traps, 0);

    const revoked = Proxy.revocable(preparedRaw, {});
    revoked.revoke();
    invalid(() => projectArmAdmissionV1(revoked.proxy, main(1)));
    assert.equal(traps, 0);

    const getter = clone(preparedRaw);
    Object.defineProperty(getter, 'unreviewed', { enumerable: true, get() {
      traps++; throw new Error('getter');
    } });
    invalid(() => projectArmAdmissionV1(getter, main(1)));
    assert.equal(traps, 0);

    const recordProxy = new Proxy(prepared, {
      get() { traps++; throw new Error('record get'); },
      ownKeys() { traps++; throw new Error('record ownKeys'); },
    });
    invalid(() => encodeArmSidecarRecordV1(recordProxy, 1, encodedHeader.sha256));
    assert.equal(traps, 0);
  });
});
