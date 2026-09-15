export function adjudicateFixedCanaries(rawOutput, expected) {
  // Validate expected first
  if (!Array.isArray(expected) || expected.length < 1) {
    throw new TypeError('expected must be a non-empty array');
  }
  
  const seenOps = new Set();
  for (const row of expected) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      throw new TypeError('expected elements must be objects');
    }
    if (typeof row.operation !== 'string' || row.operation === '') {
      throw new TypeError('operation must be a nonempty string');
    }
    if (seenOps.has(row.operation)) {
      throw new TypeError('operation must be unique across expected array');
    }
    seenOps.add(row.operation);
    if (row.expectedOutcome !== 'ALLOWED' && row.expectedOutcome !== 'DENIED' && row.expectedOutcome !== 'SELF_REPORT') {
      throw new TypeError('expectedOutcome must be ALLOWED, DENIED, or SELF_REPORT');
    }
    if (row.expectedErrno !== undefined) {
      if (!Number.isSafeInteger(row.expectedErrno) || row.expectedErrno < 0) {
        throw new TypeError('expectedErrno must be undefined or a nonnegative safe integer');
      }
    }
    if (row.expectedPid !== undefined) {
      if (!Number.isSafeInteger(row.expectedPid) || row.expectedPid < 0) {
        throw new TypeError('expectedPid must be undefined or a nonnegative safe integer');
      }
    }
    if (row.expectedPpid !== undefined) {
      if (!Number.isSafeInteger(row.expectedPpid) || row.expectedPpid < 0) {
        throw new TypeError('expectedPpid must be undefined or a nonnegative safe integer');
      }
    }
  }

  // Process rawOutput
  let output = rawOutput;
  if (output === null || output === undefined) {
    output = '';
  }
  
  // Strip one trailing '\r' if present
  if (output.length > 0 && output[output.length - 1] === '\r') {
    output = output.slice(0, -1);
  }
  
  const lines = output.split('\n');
  const malformedLines = [];
  const wellformedRows = [];
  
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];
    
    // Skip blank/whitespace-only lines
    if (line.trim() === '') {
      continue;
    }
    
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      malformedLines.push({ line: lineNum, reason: 'INVALID_JSON' });
      continue;
    }
    
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      malformedLines.push({ line: lineNum, reason: 'NOT_AN_OBJECT' });
      continue;
    }
    
    if (typeof parsed.op !== 'string' || parsed.op === '') {
      malformedLines.push({ line: lineNum, reason: 'MISSING_OP' });
      continue;
    }
    
    wellformedRows.push({ lineNum, data: parsed });
  }
  
  // Build result structure
  const rows = [];
  const unexpectedOperations = [];
  const counts = { matched: 0, mismatched: 0, notObserved: 0, ambiguous: 0 };
  
  // Track which expected operations have been processed
  const expectedMap = new Map();
  for (const exp of expected) {
    expectedMap.set(exp.operation, exp);
  }
  
  // Group wellformed rows by op
  const opGroups = new Map();
  for (const { lineNum, data } of wellformedRows) {
    const op = data.op;
    if (!opGroups.has(op)) {
      opGroups.set(op, []);
    }
    opGroups.get(op).push(data);
  }
  
  // Process expected rows in order
  for (const exp of expected) {
    const op = exp.operation;
    const candidates = opGroups.get(op) || [];
    
    let observedOutcome = null;
    let observedErrno = null;
    let observedPid = null;
    let observedPpid = null;
    let verdict;
    
    if (candidates.length === 0) {
      verdict = 'NOT_OBSERVED';
      counts.notObserved++;
    } else if (candidates.length >= 2) {
      verdict = 'AMBIGUOUS';
      counts.ambiguous++;
    } else {
      const c = candidates[0];
      
      if (exp.expectedOutcome === 'SELF_REPORT') {
        observedOutcome = null;
        observedErrno = null;
        
        // observedPid: positive safe integer
        if (Number.isSafeInteger(c.pid) && c.pid > 0) {
          observedPid = c.pid;
        } else {
          observedPid = null;
        }
        
        // observedPpid: positive safe integer
        if (Number.isSafeInteger(c.ppid) && c.ppid > 0) {
          observedPpid = c.ppid;
        } else {
          observedPpid = null;
        }
        
        // Verdict: MATCH iff each specified expectedPid/expectedPpid equals observed
        let match = true;
        if (exp.expectedPid !== undefined && exp.expectedPid !== observedPid) {
          match = false;
        }
        if (exp.expectedPpid !== undefined && exp.expectedPpid !== observedPpid) {
          match = false;
        }
        verdict = match ? 'MATCH' : 'MISMATCH';
        if (verdict === 'MATCH') {
          counts.matched++;
        } else {
          counts.mismatched++;
        }
      } else {
        // ALLOWED or DENIED
        observedOutcome = typeof c.outcome === 'string' ? c.outcome : null;
        
        // observedErrno: nonnegative safe integer
        if (Number.isSafeInteger(c.errno) && c.errno >= 0) {
          observedErrno = c.errno;
        } else {
          observedErrno = null;
        }
        
        observedPid = null;
        observedPpid = null;
        
        // Verdict logic
        if (observedOutcome !== exp.expectedOutcome) {
          verdict = 'MISMATCH';
          counts.mismatched++;
        } else if (exp.expectedErrno !== null && exp.expectedErrno !== undefined) {
          if (observedErrno === exp.expectedErrno) {
            verdict = 'MATCH';
            counts.matched++;
          } else {
            verdict = 'MISMATCH';
            counts.mismatched++;
          }
        } else {
          verdict = 'MATCH';
          counts.matched++;
        }
      }
    }
    
    rows.push({
      operation: exp.operation,
      expectedOutcome: exp.expectedOutcome,
      expectedErrno: exp.expectedErrno !== undefined ? exp.expectedErrno : null,
      observedOutcome,
      observedErrno,
      observedPid,
      observedPpid,
      verdict
    });
  }
  
  // Collect unexpected operations in observation order
  for (const { data } of wellformedRows) {
    const op = data.op;
    if (!expectedMap.has(op)) {
      unexpectedOperations.push(op);
    }
  }
  
  // Determine overall
  const allMatched = counts.matched === rows.length && malformedLines.length === 0 && unexpectedOperations.length === 0;
  const overall = allMatched ? 'ALL_MATCHED' : 'NOT_ACCEPTED';
  
  return {
    rows,
    malformedLines,
    unexpectedOperations,
    counts,
    overall,
    isolationAccepted: false
  };
}

// Escape single-line plain-text fields only; structured evidence stays unchanged.
// Escape backslashes too, so literal escape text cannot mimic an encoded control.
function displayField(value) {
  return value.replace(/[\\\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu,
    character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
}

export function formatCanaryTable(result) {
  if (typeof result !== 'object' || result === null || !Array.isArray(result.rows) ||
      typeof result.counts !== 'object' || result.counts === null ||
      !Array.isArray(result.malformedLines) ||
      !Array.isArray(result.unexpectedOperations) ||
      typeof result.overall !== 'string') {
    throw new TypeError('Invalid result object');
  }

  const rows = result.rows;
  const lines = [];
  lines.push('Fixed canary adjudication');
  lines.push('Overall: ' + result.overall);
  lines.push('Rows:');

  for (const row of rows) {
    const expectedOutcome = row.expectedOutcome;
    const expectedErrno = row.expectedErrno;
    const observedOutcome = row.observedOutcome;
    const observedErrno = row.observedErrno;
    const observedPid = row.observedPid;
    const observedPpid = row.observedPpid;
    const verdict = row.verdict;

    let expectedPart = expectedOutcome;
    if (expectedErrno !== null) {
      expectedPart += ' errno ' + expectedErrno;
    }

    let observedPart;
    if (expectedOutcome === 'SELF_REPORT') {
      observedPart = 'pid ' + (observedPid ?? 'Unknown') + ' ppid ' + (observedPpid ?? 'Unknown');
    } else if (observedOutcome === null) {
      observedPart = 'Unknown';
    } else {
      observedPart = displayField(observedOutcome) + ' (errno ' + (observedErrno ?? 'Unknown') + ')';
    }

    lines.push('- ' + displayField(row.operation) + ': expected ' + expectedPart + ', observed ' + observedPart + ' -> ' + verdict);
  }

  lines.push('Malformed lines: ' + result.malformedLines.length);
  const unexpectedOps = result.unexpectedOperations.length === 0 ? 'none' : result.unexpectedOperations.map(displayField).join(', ');
  lines.push('Unexpected operations: ' + unexpectedOps);
  lines.push('');
  lines.push('Isolation acceptance is not established by this table.');

  return lines.join('\n') + '\n';
}
