export function formatNativeProbeSummary(view) {
  const v = view ?? {};
  
  function renderString(value) {
    return typeof value === 'string' && value !== '' ? value : 'Unknown';
  }
  
  function renderPid(value) {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : 'Unknown';
  }
  
  function renderDuration(value) {
    return Number.isSafeInteger(value) && value >= 0 ? `${value} ms` : 'Not measured';
  }
  
  function renderErrno(value) {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : 'Unknown';
  }
  
  const runId = renderString(v.runId);
  const statusText = renderString(v.statusText);
  const clientPid = renderPid(v.clientPid);
  const servicePid = renderPid(v.servicePid);
  const clientDurationMs = renderDuration(v.clientDurationMs);
  
  let operationsLines = [];
  const ops = v.operations;
  if (Array.isArray(ops) && ops.length > 0) {
    for (const row of ops) {
      const op = (typeof row === 'object' && row !== null) ? renderString(row.operation) : 'Unknown';
      const outcome = (typeof row === 'object' && row !== null) ? renderString(row.outcome) : 'Unknown';
      const errno = (typeof row === 'object' && row !== null) ? renderErrno(row.errno) : 'Unknown';
      operationsLines.push(`- ${op}: ${outcome} (errno ${errno})`);
    }
  } else {
    operationsLines = ['- Unknown'];
  }
  
  const lines = [
    'Nisi fixed native probe',
    `Run ID: ${runId}`,
    `Observed client PID: ${clientPid}`,
    `Self-reported service PID: ${servicePid}`,
    `Client duration: ${clientDurationMs}`,
    `Status: ${statusText}`,
    'Operations:',
    ...operationsLines,
    '',
    'Fixed experiment only. Generated-code execution remains disabled.',
    'Client closure does not establish service termination.'
  ];
  
  return lines.join('\n') + '\n';
}
