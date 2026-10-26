import test from 'node:test';
import assert from 'node:assert/strict';
import {createIncidentHostFixture} from './helpers/incident-host-fixture.mjs';

test('settled actual workflow host produces stable incident preview rows', {timeout: 15000}, async t => {
  const fixture = await createIncidentHostFixture(t);
  const report = await fixture.host.run(fixture.options), result = await fixture.host.settled();
  assert.equal(result.report, report); assert.equal(result.state, 'SETTLED');
  const first = fixture.host.incidentPreview(), second = fixture.host.incidentPreview();
  assert.equal(first.status, 'PREVIEW', `${first.reason ?? 'missing preview'}`);
  assert.deepEqual(first.rows.filter(r => r.binding.stage === 'tests').map(r => r.classification), ['FAILURE_CANDIDATE','PASS']);
  assert.ok(first.rows.length > 0); assert.deepEqual(second, first); assert.equal(Object.isFrozen(first), true);
  assert.equal(first.sourceTrust, 'TRUSTED_HOST_STATEMENTS_NOT_ATTESTED');
  assert.equal(first.persistable, false); assert.equal(first.learningEligible, false); assert.equal(first.authorizing, false);
  assert.equal(first.rows.every(row => row.authorizing === false && row.persistable === false && row.learningEligible === false), true);
  assert.equal(JSON.stringify(first).includes('retry-settings.mjs'), false);
});

test('incident preview refuses before settlement and while either owner drains', {timeout: 15000}, async t => {
  const before = await createIncidentHostFixture(t);
  assert.deepEqual({...before.host.incidentPreview()}, {schemaVersion:'nisi-repository-incident-preview/v1', status:'REFUSED', reason:'NO_SETTLED_RESULT', reportSha256:null, bundleFingerprint:null, rows:[], sha256:null, sourceTrust:'TRUSTED_HOST_STATEMENTS_NOT_ATTESTED', freshness:'SETTLED_SNAPSHOT_ONLY', persistable:false, learningEligible:false, authorizing:false});
  const pending = await createIncidentHostFixture(t, {pending:true});
  await pending.host.run(pending.options);
  assert.equal(pending.host.incidentPreview().reason, 'NO_SETTLED_RESULT');
  pending.release(); const settled = await pending.host.settled();
  assert.equal(settled.state, 'SETTLED'); assert.equal(pending.host.incidentPreview().status, 'PREVIEW');
});

test('quarantined or missing-evidence settlement refuses without rows', {timeout: 15000}, async t => {
  const fixture = await createIncidentHostFixture(t, {quarantined:true});
  await fixture.host.run(fixture.options); const result = await fixture.host.settled();
  const preview = fixture.host.incidentPreview();
  assert.equal(result.state, 'QUARANTINED'); assert.equal(preview.status, 'REFUSED');
  assert.equal(preview.reason, 'HOST_NOT_SETTLED'); assert.deepEqual(preview.rows, []); assert.equal(preview.sha256, null);
});

test('incident projection is additive and does not alter prior history API behavior', {timeout: 15000}, async t => {
  const fixture = await createIncidentHostFixture(t);
  assert.equal(fixture.host.historyPreview().reason, 'NO_SETTLED_RESULT');
  const report = await fixture.host.run(fixture.options), settled = await fixture.host.settled();
  const historyBefore = fixture.host.historyPreview();
  const incident = fixture.host.incidentPreview();
  assert.equal(incident.status, 'PREVIEW'); assert.equal(fixture.host.historyPreview(), historyBefore);
  assert.equal((await fixture.host.settled()), settled); assert.equal(settled.report, report);
  assert.equal(fixture.host.captureHistory({}).reason, 'INVALID_INPUT');
  assert.equal(fixture.host.historyPreview(), historyBefore);
});

test('host binds original owner methods and ignores later callback mutation', {timeout: 15000}, async t => {
  const fixture = await createIncidentHostFixture(t);
  const originalCheck = fixture.staticOwner.check, originalRun = fixture.testsOwner.run;
  const runPromise = fixture.host.run(fixture.options);
  fixture.staticOwner.check = async () => { throw new Error('mutated'); };
  fixture.testsOwner.run = async () => { throw new Error('mutated'); };
  const report = await runPromise, settled = await fixture.host.settled();
  assert.equal(report.workflowOutcome !== undefined, true); assert.equal(settled.report, report);
  assert.equal(fixture.staticOwner.check === originalCheck, false); assert.equal(fixture.testsOwner.run === originalRun, false);
  assert.equal(fixture.host.incidentPreview().status, 'PREVIEW');
});
