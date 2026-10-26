// Private observation only. Capture bytes once; reconcile that same snapshot.
// Never serialize raw events, rows, candidates, model names or filesystem paths.
import { isAbsolute } from 'node:path';
import { cloneFreeze } from '../workflow/contracts.mjs';
import { inspectPairedTrialEventStoreV1 } from '../history/paired-trial-event-store-v1.mjs';
import { reconcileTrialRetentionEventsV1 } from '../history/paired-trial-reconciliation-v1.mjs';

export function inspectTrialDirectoryV1(directory) {
  if (typeof directory !== 'string' || !directory || directory.length > 4096 || directory.includes('\0') || !isAbsolute(directory))
    throw Object.assign(Error('NISI_CLI_ARGUMENTS'), { code: 'NISI_CLI_ARGUMENTS' });
  const bytes = inspectPairedTrialEventStoreV1({ directory });
  const semantic = ['FINAL_PRESENT', 'INCOMPLETE', 'PARTIAL_TAIL', 'CORRUPT'].includes(bytes.status)
    ? reconcileTrialRetentionEventsV1({ events: bytes.events, byteStatus: bytes.status }) : null;
  const observed = bytes.status === 'FINAL_PRESENT' && semantic?.status === 'FINAL_CONSISTENT';
  const interrupted = semantic?.status === 'INTERRUPTED';
  const incomplete = bytes.status === 'EMPTY' || interrupted;
  const metadata = observed || interrupted ? semantic : null;
  return cloneFreeze({ schemaVersion: 'nisi-cli-trial-inspection-v1',
    status: observed ? 'OBSERVED' : incomplete ? 'INCOMPLETE' : 'REFUSED', exitCode: observed ? 0 : incomplete ? 1 : 2,
    byteStatus: bytes.status, semanticStatus: semantic?.status ?? 'NOT_PERFORMED',
    counts: metadata ? {
      planned: metadata.counts.planned, uniqueTasks: metadata.counts.uniqueTasks, repetitions: metadata.counts.repetitions,
      startIntents: metadata.counts.startIntents, completePhaseRecords: metadata.counts.completePhaseRecords,
      incompletePhaseRecords: metadata.counts.incompletePhaseRecords,
    } : null,
    runnerId: metadata?.runnerId ?? null, planSha256: metadata?.planSha256 ?? null,
    profileSha256: metadata?.profileSha256 ?? null, finalStopReason: metadata?.finalStopReason ?? null,
    actualDispatchCount: null, sourceTrust: 'UNAUTHENTICATED_HOST_STATEMENTS',
    creationAcknowledgement: 'UNKNOWN', durabilityAcknowledgement: 'UNKNOWN', remoteExecutionStopped: 'UNKNOWN',
    durationBudgetReconciliation: 'NOT_RECONCILABLE_FROM_RETAINED_EVENTS', drainSemantics: 'NOT_VALIDATED',
    candidateBytesRevalidated: false, measurementVerified: false, causalClaim: false,
    authorizing: false, resumable: false, promotionEligible: false });
}
