// Fixed-canary vocabulary adapter v1. Pure data mapping: no I/O, no clock, no randomness.
// Provenance: PC-worker draft (5/14) retained under .packets/*.pc-jobs/; rewritten by the
// integrator against the reviewed contract. The tests are the contract.

const OWN = (o, k) => Object.hasOwn(o, k);
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = v => typeof v === 'string' && v !== '';

export function fixedCanaryMappingV1() {
  return {
    version: 'nisi-fixed-canary-mapping/v1',
    operations: {
      own_container_write: 'own-write',
      own_container_read: 'own-read',
      outside_read: 'outside-read',
      ipv4_loopback_bind: 'loopback-bind',
      self_report: 'self-report'
    },
    outcomes: { allowed: 'ALLOWED' },
    denialSignatures: {
      outside_read: { errno: 1, code: 'EPERM', syscall: 'open' },
      ipv4_loopback_bind: { errno: 1, code: 'EPERM', syscall: 'listen' }
    },
    identityOperation: 'self_report'
  };
}

function validateMapping(mapping) {
  if (!isObject(mapping)) throw new TypeError('mapping must be a non-null, non-array object');
  if (!OWN(mapping, 'version') || typeof mapping.version !== 'string') throw new TypeError('mapping.version must be a string');
  for (const table of ['operations', 'outcomes', 'denialSignatures']) {
    if (!OWN(mapping, table) || !isObject(mapping[table])) throw new TypeError(`mapping.${table} must be a non-null, non-array object`);
  }
  for (const [key, value] of Object.entries(mapping.operations)) {
    if (!isNonEmptyString(value)) throw new TypeError(`mapping.operations.${key} must be a nonempty string`);
  }
  for (const [key, sig] of Object.entries(mapping.denialSignatures)) {
    if (!isObject(sig) || !OWN(sig, 'errno') || !Number.isSafeInteger(sig.errno)
      || !OWN(sig, 'code') || typeof sig.code !== 'string'
      || !OWN(sig, 'syscall') || typeof sig.syscall !== 'string') {
      throw new TypeError(`mapping.denialSignatures.${key} must have integer errno, string code and string syscall`);
    }
  }
  if (!OWN(mapping, 'identityOperation') || !isNonEmptyString(mapping.identityOperation)) {
    throw new TypeError('mapping.identityOperation must be a nonempty string');
  }
}

// Duplicate member-name detection on raw text, tolerant of any input, never throws.
// Keys are compared decoded when the quoted literal is valid JSON, otherwise by raw text,
// each within the object they belong to (a stack of per-object key sets).
function hasDuplicateMember(text) {
  const decodedSets = [];
  const rawSets = [];
  let inString = false;
  let escape = false;
  let start = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch !== '"') continue;
      inString = false;
      const top = decodedSets.length ? decodedSets[decodedSets.length - 1] : null;
      if (top === null) continue;                     // not directly inside an object
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j += 1;
      if (j >= text.length || text[j] !== ':') continue;   // a value, not a member name
      const literal = text.slice(start, i + 1);
      let decoded = null;
      try { decoded = JSON.parse(literal); } catch { decoded = null; }
      if (typeof decoded === 'string') {
        if (top.has(decoded)) return true;
        top.add(decoded);
      } else {
        const raw = rawSets[rawSets.length - 1];
        if (raw.has(literal)) return true;
        raw.add(literal);
      }
      continue;
    }
    if (ch === '"') { inString = true; escape = false; start = i; continue; }
    if (ch === '{') { decodedSets.push(new Set()); rawSets.push(new Set()); continue; }
    if (ch === '[') { decodedSets.push(null); rawSets.push(null); continue; }
    if (ch === '}' || ch === ']') { if (decodedSets.length) { decodedSets.pop(); rawSets.pop(); } }
  }
  return false;
}

const entry = (line, action, operation = null, op = null, outcome = null, mappedOutcome = null) =>
  ({ line, action, operation, op, outcome, mappedOutcome });

export function adaptFixedCanaryOutput(rawStdout, mapping) {
  validateMapping(mapping);
  if (rawStdout === null || rawStdout === undefined) rawStdout = '';
  if (typeof rawStdout !== 'string') throw new TypeError('rawStdout must be a string, null or undefined');

  const operationValues = new Set(Object.values(mapping.operations));
  const identity = mapping.identityOperation;
  const output = [];
  const report = [];
  const counts = { mapped: 0, passthrough: 0, rejected: 0, blank: 0 };
  const lines = rawStdout.split('\n');

  const reject = (n, reason, action) => {
    output.push(JSON.stringify({ op: '', reason }));
    report.push(entry(n, action));
    counts.rejected += 1;
  };
  const passthrough = (n, text, action) => {
    output.push(text);
    report.push(entry(n, action));
    counts.passthrough += 1;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const n = i + 1;
    const text = lines[i].endsWith('\r') ? lines[i].slice(0, -1) : lines[i];
    if (text.trim() === '') { output.push(''); report.push(entry(n, 'BLANK')); counts.blank += 1; continue; }
    if (hasDuplicateMember(text)) { reject(n, 'DUPLICATE_KEY', 'REJECTED_DUPLICATE_KEY'); continue; }

    let rec;
    try { rec = JSON.parse(text); } catch { passthrough(n, text, 'PASSTHROUGH_INVALID'); continue; }
    if (!isObject(rec)) { passthrough(n, text, 'PASSTHROUGH_INVALID'); continue; }

    // Vocabulary guards: contradictory or mixed evidence never reaches the adjudicator as a match.
    const untrusted = () => reject(n, 'UNTRUSTED_VOCABULARY', 'REJECTED_UNTRUSTED_VOCABULARY');
    if (OWN(rec, 'op')) { untrusted(); continue; }
    const operation = OWN(rec, 'operation') ? rec.operation : undefined;
    if (!isNonEmptyString(operation)) { passthrough(n, text, 'PASSTHROUGH_NO_OPERATION'); continue; }
    const mapped = OWN(mapping.operations, operation) ? mapping.operations[operation] : null;
    if (mapped === null && operationValues.has(operation)) { untrusted(); continue; }
    const hasOutcome = OWN(rec, 'outcome');
    const hasErrno = OWN(rec, 'errno');
    const hasDiagnostics = OWN(rec, 'code') || OWN(rec, 'syscall');
    const isIdentity = mapped !== null && operation === identity;
    if (isIdentity) {
      if ((hasOutcome && rec.outcome !== 'observed') || (hasErrno && rec.errno !== 0) || hasDiagnostics) { untrusted(); continue; }
    } else if (mapped !== null) {
      if ((rec.outcome === 'ALLOWED' || rec.outcome === 'DENIED') && !OWN(mapping.outcomes, rec.outcome)) { untrusted(); continue; }
      if (rec.outcome !== 'error' && hasDiagnostics) { untrusted(); continue; }
    }

    const reportedOutcome = typeof rec.outcome === 'string' ? rec.outcome : null;

    if (isIdentity) {
      const out = { op: mapped };
      if (OWN(rec, 'pid')) out.pid = rec.pid;
      if (OWN(rec, 'ppid')) out.ppid = rec.ppid;
      output.push(JSON.stringify(out));
      report.push(entry(n, 'MAPPED_IDENTITY', operation, mapped, reportedOutcome));
      counts.mapped += 1;
      continue;
    }

    if (mapped !== null) {
      const out = { op: mapped };
      let action = 'MAPPED_OUTCOME_UNKNOWN';
      let mappedOutcome = null;
      if (hasOutcome) out.outcome = rec.outcome;
      if (hasErrno) out.errno = rec.errno;
      if (rec.outcome === 'error') {
        const sig = OWN(mapping.denialSignatures, operation) ? mapping.denialSignatures[operation] : null;
        if (sig !== null && rec.errno === sig.errno && rec.code === sig.code && rec.syscall === sig.syscall) {
          out.outcome = 'DENIED'; action = 'MAPPED_DENIAL'; mappedOutcome = 'DENIED';
        } else {
          out.outcome = 'ERROR'; action = 'MAPPED_ERROR_UNRECOGNIZED'; mappedOutcome = 'ERROR';
        }
      } else if (typeof rec.outcome === 'string' && OWN(mapping.outcomes, rec.outcome)) {
        out.outcome = mapping.outcomes[rec.outcome]; action = 'MAPPED'; mappedOutcome = out.outcome;
      }
      output.push(JSON.stringify(out));
      report.push(entry(n, action, operation, mapped, reportedOutcome, mappedOutcome));
      counts.mapped += 1;
      continue;
    }

    const out = { op: operation };
    if (hasOutcome) out.outcome = rec.outcome;
    if (hasErrno) out.errno = rec.errno;
    output.push(JSON.stringify(out));
    report.push(entry(n, 'PASSTHROUGH_UNMAPPED_OPERATION', operation, operation, reportedOutcome));
    counts.passthrough += 1;
  }

  return { version: mapping.version, adaptedOutput: output.join('\n'), report, counts };
}

export function expectedMatrixFor(runtime) {
  if (!isObject(runtime)) throw new TypeError('runtime must be a non-null, non-array object');
  for (const key of ['childPid', 'servicePid']) {
    if (!OWN(runtime, key) || !Number.isSafeInteger(runtime[key]) || runtime[key] <= 0) {
      throw new TypeError(`runtime.${key} must be a positive safe integer`);
    }
  }
  return [
    { operation: 'own-write', expectedOutcome: 'ALLOWED', expectedErrno: 0 },
    { operation: 'own-read', expectedOutcome: 'ALLOWED', expectedErrno: 0 },
    { operation: 'outside-read', expectedOutcome: 'DENIED', expectedErrno: 1 },
    { operation: 'loopback-bind', expectedOutcome: 'DENIED', expectedErrno: 1 },
    { operation: 'self-report', expectedOutcome: 'SELF_REPORT', expectedPid: runtime.childPid, expectedPpid: runtime.servicePid }
  ];
}
