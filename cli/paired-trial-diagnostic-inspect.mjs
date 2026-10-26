// Read-only redacted snapshot. No model, source execution, writes or admission.
import { isAbsolute } from 'node:path';
import { cloneFreeze } from '../workflow/contracts.mjs';
import { inspectRepositoryTrialDiagnosticV1 } from '../history/repository-trial-diagnostic-store-v1.mjs';
export function inspectTrialDiagnosticFileV1(file) {
  if (typeof file !== 'string' || !file || file.length > 4096 || file.includes('\0') || !isAbsolute(file))
    throw Object.assign(Error('NISI_CLI_ARGUMENTS'), { code: 'NISI_CLI_ARGUMENTS' });
  const result = inspectRepositoryTrialDiagnosticV1(file);
  const exitCode = result.status !== 'OBSERVED' ? 2 : result.diagnostic.kind === 'PARTIAL_CHANNELS' ? 1 : 0;
  return cloneFreeze({ ...result, exitCode });
}
