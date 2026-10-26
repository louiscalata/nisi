// PRIVATE data-only diagnostic projection, not an issued acceptance context.
// A workspace capability cannot be serialized or restored from this evidence.
import { cloneFreeze } from '../../workflow/contracts.mjs';
import { exact, refuse } from '../../integrity/record-utils.mjs';
import { issuedTaskWorkspaceV1 } from './task-workspace-v1.mjs';

export function createRepositoryHostEvidenceV1(host) {
  exact(host, ['schemaVersion', 'report', 'invocations', 'staticHistory', 'testHistory',
    'settlementErrors', 'historyErrors', 'ownerStateErrors', 'ownerStates', 'state', 'bundle',
    'bundleSummary', 'bundleError', 'proposedChanges', 'applied', 'sandboxed', 'authorizing',
    'certificationGranted'], 'HOST_EVIDENCE_SCHEMA');
  if (host.schemaVersion !== 'nisi-reviewed-repository-host-v1' ||
      ['applied', 'sandboxed', 'authorizing', 'certificationGranted'].some(key => host[key] !== false))
    refuse('HOST_EVIDENCE_CLAIM');
  const rows = host.testHistory;
  if (!Array.isArray(rows) || rows.length > 101) refuse('HOST_EVIDENCE_HISTORY');
  // Validate dense data-only array descriptors before reading entries; callbacks
  // and accessors are not a general-purpose serialization escape hatch.
  const descriptors = Object.getOwnPropertyDescriptors(rows);
  if (Reflect.ownKeys(descriptors).length !== rows.length + 1) refuse('HOST_EVIDENCE_HISTORY');
  const testHistory = [];
  for (let i = 0; i < rows.length; i++) {
    if (!Object.hasOwn(descriptors, i) || !Object.hasOwn(descriptors[i], 'value') || !descriptors[i].enumerable) refuse('HOST_EVIDENCE_HISTORY');
    const row = descriptors[i].value;
    exact(row, ['preparation', 'workspace', 'execution', 'adapterResult', 'error'], 'HOST_EVIDENCE_ROW');
    let workspace = null;
    if (row.workspace !== null) {
      const view = issuedTaskWorkspaceV1(row.workspace);
      workspace = { root: view.root, manifest: view.manifest, state: view.state,
        stateProvenance: 'ISSUED_OWNER_AT_CAPTURE', capabilitiesRetained: false };
    }
    testHistory.push({ ...row, workspace });
  }
  return cloneFreeze({ ...host, schemaVersion: 'nisi-reviewed-repository-host-evidence/v1',
    originalHostSchemaVersion: host.schemaVersion, testHistory, restoresAuthority: false });
}
