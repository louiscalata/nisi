// Fixed fixture materialization only: no native processes, inference or acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepositoryHostEvidenceV1 } from '../hosts/repository/host-evidence-v1.mjs';
import { cloneFreeze } from '../workflow/contracts.mjs';
import { context } from './helpers/node-repository-fixture.mjs';

const host = (workspace = null) => ({ schemaVersion: 'nisi-reviewed-repository-host-v1',
  report: { outcome: 'CANCELLED' }, invocations: [], staticHistory: [],
  testHistory: [{ preparation: null, workspace, execution: null, adapterResult: null, error: null }],
  settlementErrors: [null, null], historyErrors: [null, null], ownerStateErrors: [null, null],
  ownerStates: { staticChecks: 'IDLE', tests: 'IDLE' }, state: 'SETTLED', bundle: null,
  bundleSummary: null, bundleError: null, proposedChanges: null,
  applied: false, sandboxed: false, authorizing: false, certificationGranted: false });

test('issued workspace becomes a versioned immutable data view, never a restored capability', async t => {
  const c = await context(t), workspace = await c.workspace(), original = host(workspace);
  assert.throws(() => cloneFreeze(original), { code: 'INPUT_VALUE_INVALID' });
  const historyBefore = workspace.observations();
  const evidence = createRepositoryHostEvidenceV1(original);
  assert.equal(evidence.schemaVersion, 'nisi-reviewed-repository-host-evidence/v1');
  assert.equal(evidence.originalHostSchemaVersion, original.schemaVersion);
  assert.equal(evidence.restoresAuthority, false); assert.equal(evidence.authorizing, false);
  const view = evidence.testHistory[0].workspace;
  assert.equal(view.root, workspace.root); assert.deepEqual(view.manifest, workspace.manifest);
  assert.equal(view.state, 'MATERIALIZED'); assert.equal(view.capabilitiesRetained, false);
  assert.equal(view.stateProvenance, 'ISSUED_OWNER_AT_CAPTURE');
  assert.deepEqual(workspace.observations(), historyBefore);
  assert.ok(Object.isFrozen(view)); assert.strictEqual(original.testHistory[0].workspace, workspace);
  assert.equal(typeof workspace.checkpoint, 'function');
  assert.throws(() => createRepositoryHostEvidenceV1(host(view)), { code: 'WORKSPACE_OWNER_NOT_ISSUED' });
  assert.throws(() => createRepositoryHostEvidenceV1(evidence), { code: 'HOST_EVIDENCE_SCHEMA' });
  await workspace.checkpoint('PRE');
  assert.equal(createRepositoryHostEvidenceV1(original).testHistory[0].workspace.state, 'PRECHECKED');
  assert.equal(view.state, 'MATERIALIZED'); // Earlier evidence stays immutable.
});

test('null workspace and adverse diagnostics survive without invented positive evidence', () => {
  const source = host(); source.bundleError = { code: 'INCOMPLETE' }; source.state = 'QUARANTINED';
  const evidence = createRepositoryHostEvidenceV1(source);
  assert.equal(evidence.testHistory[0].workspace, null); assert.equal(evidence.bundleError.code, 'INCOMPLETE');
  assert.equal(evidence.state, 'QUARANTINED'); assert.equal(evidence.proposedChanges, null);
});

test('unknown schemas, claims and non-data properties are rejected, not silently stripped', () => {
  assert.throws(() => createRepositoryHostEvidenceV1({ ...host(), schemaVersion: 'other' }), { code: 'HOST_EVIDENCE_CLAIM' });
  assert.throws(() => createRepositoryHostEvidenceV1({ ...host(), extra: 1 }), { code: 'HOST_EVIDENCE_SCHEMA' });
  for (const key of ['applied', 'sandboxed', 'authorizing', 'certificationGranted'])
    assert.throws(() => createRepositoryHostEvidenceV1({ ...host(), [key]: true }), { code: 'HOST_EVIDENCE_CLAIM' });
  assert.throws(() => createRepositoryHostEvidenceV1({ ...host(), report: { hidden: () => 1 } }), { code: 'INPUT_VALUE_INVALID' });
  let invoked = false;
  const source = host(); Object.defineProperty(source, 'report', { enumerable: true, get() { invoked = true; } });
  assert.throws(() => createRepositoryHostEvidenceV1(source), { code: 'HOST_EVIDENCE_SCHEMA' });
  const rows = []; Object.defineProperty(rows, 0, { enumerable: true, get() { invoked = true; } });
  assert.throws(() => createRepositoryHostEvidenceV1({ ...host(), testHistory: rows }), { code: 'HOST_EVIDENCE_HISTORY' });
  assert.throws(() => createRepositoryHostEvidenceV1({ ...host(), testHistory: new Array(1) }), { code: 'HOST_EVIDENCE_HISTORY' });
  assert.equal(invoked, false);
  const fake = { root: '/fake', manifest: {}, status() { invoked = true; }, checkpoint() { invoked = true; } };
  assert.throws(() => createRepositoryHostEvidenceV1(host(fake)), { code: 'WORKSPACE_OWNER_NOT_ISSUED' });
  assert.equal(invoked, false);
});
