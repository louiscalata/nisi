const OPERATIONS = Object.freeze([
  'own-open-write', 'own-write', 'own-close-write',
  'own-open-read', 'own-read', 'own-close-read',
  'outside-open-read', 'outside-read', 'outside-close-read',
  'outside-open-write', 'outside-write', 'outside-close-write',
  'socket-create', 'socket-bind', 'socket-close',
  'fixed-child-spawn', 'fixed-child-wait',
]);
const OUTCOMES = new Set(['ALLOWED', 'DENIED', 'ERROR', 'NOT_RUN']);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const own = (value, keys, code) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort(), expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, i) => key !== expected[i])) fail(code);
};
const integer = value => Number.isSafeInteger(value) && value >= 0;
const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};
function parseUnique(line) {
  let parsed;
  try { parsed = JSON.parse(line); } catch { fail('FIXED_PROBE_JSON'); }
  const keys = [];
  let depth = 0, inString = false, escaped = false, token = '';
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inString) {
      token += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') {
        inString = false;
        let j = i + 1; while (/\s/u.test(line[j] ?? '')) j += 1;
        if (depth === 1 && line[j] === ':') keys.push(JSON.parse(token));
        token = '';
      }
    } else if (char === '"') { inString = true; token = '"'; }
    else if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
  }
  if (new Set(keys).size !== keys.length) fail('FIXED_PROBE_DUPLICATE_KEY');
  return parsed;
}
function validateRow(row, index) {
  own(row, ['operation', 'outcome', 'errno'], 'FIXED_PROBE_ROW_SCHEMA');
  if (row.operation !== OPERATIONS[index]) fail('FIXED_PROBE_ORDER');
  if (!OUTCOMES.has(row.outcome)) fail('FIXED_PROBE_OUTCOME');
  if (!integer(row.errno)) fail('FIXED_PROBE_ERRNO');
  if (row.outcome === 'ALLOWED' && row.errno !== 0) fail('FIXED_PROBE_ERRNO');
  if (row.outcome === 'DENIED' && ![1, 13].includes(row.errno)) fail('FIXED_PROBE_ERRNO');
  if (row.outcome === 'NOT_RUN' && row.errno !== 0) fail('FIXED_PROBE_ERRNO');
}
function validateDependencies(rows) {
  const byName = Object.fromEntries(rows.map(row => [row.operation, row]));
  const groups = [
    ['own-open-write', 'own-write', 'own-close-write'],
    ['own-open-read', 'own-read', 'own-close-read'],
    ['outside-open-read', 'outside-read', 'outside-close-read'],
    ['outside-open-write', 'outside-write', 'outside-close-write'],
    ['socket-create', 'socket-bind', 'socket-close'],
    ['fixed-child-spawn', 'fixed-child-wait'],
  ];
  for (const group of groups) {
    const [first, ...dependents] = group;
    if (byName[first].outcome === 'NOT_RUN') fail('FIXED_PROBE_DEPENDENCY');
    if (byName[first].outcome !== 'ALLOWED') {
      if (dependents.some(name => byName[name].outcome !== 'NOT_RUN')) fail('FIXED_PROBE_DEPENDENCY');
    } else if (dependents.some(name => byName[name].outcome === 'NOT_RUN')) {
      fail('FIXED_PROBE_DEPENDENCY');
    }
  }
}
export function parseFixedProbeV1(stdout, expected) {
  if (!Buffer.isBuffer(stdout) && typeof stdout !== 'string') fail('FIXED_PROBE_BYTES');
  const bytes = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout, 'utf8');
  if (bytes.length > 32768) fail('FIXED_PROBE_BYTES');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('FIXED_PROBE_UTF8'); }
  if (text.includes('\r') || text.length === 0) fail('FIXED_PROBE_FRAME');
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
  if (lines.length !== OPERATIONS.length + 1 || lines.some(line => line.length === 0)) fail('FIXED_PROBE_FRAME');
  if (expected === null || typeof expected !== 'object' || Array.isArray(expected)) fail('FIXED_PROBE_EXPECTED');
  own(expected, ['runId', 'mode', 'expectedPid', 'expectedHome'], 'FIXED_PROBE_EXPECTED');
  if (typeof expected.runId !== 'string' || !/^[a-f0-9]{32}$/u.test(expected.runId) ||
      !['sandbox', 'control'].includes(expected.mode) || !Number.isSafeInteger(expected.expectedPid) || expected.expectedPid <= 0 ||
      typeof expected.expectedHome !== 'string' || expected.expectedHome.length === 0) fail('FIXED_PROBE_EXPECTED');
  const meta = parseUnique(lines[0]);
  own(meta, ['schemaVersion', 'runId', 'mode', 'pid', 'home'], 'FIXED_PROBE_META_SCHEMA');
  if (meta.schemaVersion !== 'nisi-fixed-probe-v1' || meta.runId !== expected.runId || meta.mode !== expected.mode ||
      meta.pid !== expected.expectedPid || meta.home !== expected.expectedHome) fail('FIXED_PROBE_META_IDENTITY');
  if (!Number.isSafeInteger(meta.pid) || meta.pid <= 0 || typeof meta.home !== 'string' || meta.home.length === 0) fail('FIXED_PROBE_META');
  const rows = lines.slice(1).map(parseUnique);
  rows.forEach(validateRow);
  validateDependencies(rows);
  return deepFreeze({ meta, rows });
}
