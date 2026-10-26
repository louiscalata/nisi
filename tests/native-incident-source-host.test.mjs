import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createNativeIncidentSourcePlanV1, readNativeIncidentSourceInputV1} from '../hosts/repository/native-incident-source-v1.mjs';
import {createIncidentHostFixture} from './helpers/incident-host-fixture.mjs';
import {createPagedIncidentHostFixture} from './helpers/incident-review-fixture.mjs';

const publicKeys = ['schemaVersion','status','reason','selection','sourcePlanDigest','rawContentIncluded',
  'persistable','freshness','requiresSeparateAdmission','nativeRerun','executionVerified','learningEligible',
  'authorizing'];
const assertRefused = (result, reason) => { assert.equal(result.status, 'REFUSED'); assert.equal(result.reason, reason); };
const settledPaged = async () => { const f = await createPagedIncidentHostFixture(); return f; };

test('actual settled host binds an original static failure source without exposing content', {timeout: 15000}, async () => {
  const f = await settledPaged(), row = f.eligible[0], before = await f.host.settled();
  const result = f.host.nativeIncidentSourcePlan({rowId: row.rowId});
  assert.equal(result.status, 'SOURCE_BOUND'); assert.deepEqual(Object.keys(result).sort(), [...publicKeys].sort());
  assert.deepEqual(Object.keys(result.selection).sort(), ['rowId','rowFingerprint','previewSha256','binding','source','profile','artifactByteLength','priorTranscriptSha256','inputSha256'].sort());
  assert.equal(result.selection.rowId, row.rowId); assert.equal(result.selection.rowFingerprint, row.fingerprint); assert.equal(result.selection.previewSha256, f.preview.sha256);
  assert.equal(result.rawContentIncluded, false); assert.equal(result.persistable, false); assert.equal(result.authorizing, false);
  assert.equal(result.learningEligible, false); assert.equal(result.nativeRerun, 'NOT_RUN'); assert.equal(result.requiresSeparateAdmission, true);
  assert.equal(result.executionVerified, false);
  assert.equal(result.freshness, 'ORIGINAL_SNAPSHOT_ONLY');
  for (const forbidden of ['content','bytes','stdout','transcript','path']) assert.equal(Object.hasOwn(result, forbidden), false);
  const input = readNativeIncidentSourceInputV1({plan: result});
  assert.equal(input.schemaVersion, 'nisi-native-incident-source-input/v1');
  assert.equal(input.rowId, result.selection.rowId); assert.equal(input.rowFingerprint, result.selection.rowFingerprint);
  assert.equal(input.previewSha256, result.selection.previewSha256);
  assert.equal(typeof input.artifact.relativePath, 'string');
  assert.equal(typeof input.artifact.content, 'string');
  assert.equal(input.artifact.sha256, createHash('sha256').update(input.artifact.content, 'utf8').digest('hex'));
  assert.equal(input.artifact.byteLength, Buffer.byteLength(input.artifact.content));
  assert.equal(input.artifact.byteLength, result.selection.artifactByteLength);
  assert.equal(await f.host.settled(), before);
});

test('source plan is gated before settlement, while draining, and when quarantined', {timeout: 15000}, async t => {
  const before = await createIncidentHostFixture(t);
  assertRefused(before.host.nativeIncidentSourcePlan({rowId: 'a'.repeat(64)}), 'HOST_NOT_SETTLED');
  const pending = await createIncidentHostFixture(t, {pending: true}); await pending.host.run(pending.options);
  assertRefused(pending.host.nativeIncidentSourcePlan({rowId: 'a'.repeat(64)}), 'HOST_NOT_SETTLED'); pending.release(); await pending.host.settled();
  const quarantined = await createIncidentHostFixture(t, {quarantined: true}); await quarantined.host.run(quarantined.options); await quarantined.host.settled();
  assertRefused(quarantined.host.nativeIncidentSourcePlan({rowId: 'a'.repeat(64)}), 'HOST_NOT_SETTLED');
});

test('invalid row input and Node-stage rows refuse without changing incident/history APIs', {timeout: 15000}, async t => {
  const f = await settledPaged();
  for (const value of [null, {}, [], {rowId:'x'}, {rowId:'a'.repeat(64), extra:true}]) assertRefused(f.host.nativeIncidentSourcePlan(value), 'INVALID_INPUT');
  const node = await createIncidentHostFixture(t); await node.host.run(node.options); const settled = await node.host.settled();
  const nodeRow = node.host.incidentPreview().rows.find(row => row.binding.stage === 'tests'); assert.ok(nodeRow);
  assertRefused(node.host.nativeIncidentSourcePlan({rowId: nodeRow.rowId}), 'UNSUPPORTED_STAGE');
  assert.equal((await node.host.settled()), settled); assert.equal(node.host.historyPreview().status, 'PREVIEW');
});

test('accessor accepts only the original issued plan and rejects clones or altered plans', {timeout: 15000}, async () => {
  const f = await settledPaged(), result = f.host.nativeIncidentSourcePlan({rowId: f.eligible[0].rowId});
  assert.equal(result.status, 'SOURCE_BOUND');
  const cloned = structuredClone(result); assert.throws(() => readNativeIncidentSourceInputV1({plan: cloned}), {code:'NATIVE_SOURCE_NOT_ISSUED'});
  assert.throws(() => readNativeIncidentSourceInputV1({plan: {...result}}), {code:'NATIVE_SOURCE_NOT_ISSUED'});
  const accessor = {};
  Object.defineProperty(accessor, 'plan', {enumerable:true, get() { throw Error('NO_GETTER'); }});
  assert.throws(() => readNativeIncidentSourceInputV1(accessor), {code:'NATIVE_SOURCE_INPUT_SCHEMA'});
});
