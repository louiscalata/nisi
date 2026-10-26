// PRIVATE nonexecuting negative fixtures; each expected diagnostic is checked by tsc.
import { Buffer } from 'node:buffer';
import { createCandidate, createFileAccessPolicy, type RunReport, type TaskSpecification, type AdapterResult, type TestEvidence, type Binding } from 'nisi';
import { createLocalChatAuthorAdapter, createLocalChatTransportOwner } from 'nisi/adapters/local-chat';
import { canonicalizeJSONV1 } from 'nisi/canonical/canonical-json-v1.mjs';
// @ts-expect-error The root does not export the local transport owner.
import { createLocalChatTransportOwner as absentRootOwner } from 'nisi';
// @ts-expect-error The old canonical subpath has no descriptive alias at runtime.
import { canonicalizeJsonV1 } from 'nisi/canonical/canonical-json-v1.mjs';
// @ts-expect-error The old consent subpath has no descriptive alias at runtime.
import { createFileAccessPolicy as absentPolicyAlias } from 'nisi/gate/content-consent.mjs';
// @ts-expect-error The old AFM subpath has no descriptive alias at runtime.
import { createAppleFoundationModelsAdapter } from 'nisi/gate/afm-content-executor.mjs';

export function negativeCases(report: RunReport, task: TaskSpecification) {
  const candidate = createCandidate({ files: [{ path: 'a.mjs', content: '' }] }, { authorId: 'author.one' });
  // @ts-expect-error Required authorId cannot be omitted.
  createCandidate({ files: [] });
  // @ts-expect-error Candidate input is a closed fresh record.
  createCandidate({ files: [], extra: true }, { authorId: 'author.one' });
  // @ts-expect-error Invalid workflow modes are refused at the type boundary.
  const invalidTask: TaskSpecification = { ...task, mode: 'apply' };
  // @ts-expect-error The grant constructor requires a supplied clock.
  createFileAccessPolicy(Buffer.alloc(0), {});
  // @ts-expect-error Raw strings are not byte input to the codec.
  canonicalizeJSONV1('{"a":1}');
  // @ts-expect-error Reports are immutable.
  report.outcome = 'COMPLETED';
  // @ts-expect-error Candidate members are immutable.
  candidate.files[0]!.content = 'rewritten';
  // @ts-expect-error Task policy cannot be modified through a normalized task.
  task.policy.repairBudget = 9;
  // @ts-expect-error Buffer-only policy intake must not claim Uint8Array acceptance.
  createFileAccessPolicy(new Uint8Array(), { clock: () => 0 });
  const policy = createFileAccessPolicy(Buffer.alloc(0), { clock: () => 0 });
  // @ts-expect-error A refusal result has no usable grant before narrowing.
  policy.grant.revoke();
  if (policy.ok) {
    const authority: false = policy.authorizing;
    const consentClass: 'WRITTEN_DECLARATION' = policy.grant.status().consentClass;
    void [authority, consentClass];
  }
  const options = { endpoint: 'http://127.0.0.1:1234/v1/chat/completions', destination: 'LOOPBACK_HTTP', model: 'fixture', id: 'author.one' } satisfies Parameters<typeof createLocalChatAuthorAdapter>[0];
  createLocalChatAuthorAdapter({ ...options, transportOwner: createLocalChatTransportOwner() });
  // @ts-expect-error Arbitrary remote destinations are not implemented.
  createLocalChatAuthorAdapter({ ...options, destination: 'REMOTE_HTTP' });
  // @ts-expect-error The runtime requires an issued transport owner, not a structural imitation.
  createLocalChatAuthorAdapter({ ...options, transportOwner: { status: () => ({ schemaVersion: 1, state: 'IDLE', pendingTransports: 0, recoveryRequired: false, remoteInferenceStopped: 'NOT_OBSERVED', scope: 'THIS_OWNER_ONLY' }), stop: () => {} } });
  const binding = { schemaVersion: 1, runId: 'run', taskFingerprint: 'hash', attempt: 0, candidateFingerprint: 'candidate' } satisfies Binding;
  // @ts-expect-error Test evidence must include assertionsPassed.
  const missingPassed: AdapterResult<TestEvidence> = { status: 'PASS', evidence: { ...binding, assertionsExecuted: 1, failures: [], reason: '' } };
  void [binding, canonicalizeJSONV1, missingPassed];
}
