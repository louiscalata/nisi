// PRIVATE fixed-fixture data readers. Importing this module performs no I/O.
// Successful parsing is not isolation, caller authority, or task acceptance.
const OPERATIONS = Object.freeze([
  'own-open-write', 'own-write', 'own-close-write',
  'own-open-read', 'own-read', 'own-close-read',
  'outside-open-read', 'outside-read', 'outside-close-read',
  'outside-open-write', 'outside-write', 'outside-close-write',
  'socket-create', 'socket-bind', 'socket-close',
]);
const OUTCOMES = ['NOT_RUN', 'ALLOWED', 'DENIED', 'ERROR'];
const CLIENT_KEYS = ['authorizing', 'home', 'pid', 'replyBase64', 'runId', 'schemaVersion', 'status'];
const CLIENT_STATUSES = ['REPLY_RECEIVED', 'MALFORMED', 'TIMEOUT', 'PROXY_ERROR', 'INTERRUPTED', 'INVALIDATED', 'INCONCLUSIVE'];
const fail = code => { throw Object.assign(new Error(code), { code }); };
const pid = value => Number.isSafeInteger(value) && value > 0 && value <= 0x7fffffff;
const run = value => typeof value === 'string' && /^[0-9a-f]{32}$/u.test(value);
const home = value => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 1024 &&
  !value.includes('\0') && Buffer.from(value).toString('utf8') === value;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
function decodeUtf8(bytes) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail('XPC_UTF8'); }
  // TextDecoder otherwise silently removes a leading BOM.
  if (!Buffer.from(text).equals(bytes)) fail('XPC_UTF8_ROUNDTRIP');
  return text;
}
function validateRows(rows) {
  if (!Array.isArray(rows) || rows.length !== 15) fail('XPC_ROWS');
  for (const [index, row] of rows.entries()) {
    if (!record(row) || row.operation !== OPERATIONS[index] || !OUTCOMES.includes(row.outcome) ||
        !Number.isSafeInteger(row.errno) || row.errno < 0 || row.errno > 0x7fffffff) fail('XPC_ROW');
    if (['NOT_RUN', 'ALLOWED'].includes(row.outcome) && row.errno !== 0) fail('XPC_ERRNO');
    if (row.outcome === 'DENIED' && ![1, 13].includes(row.errno)) fail('XPC_ERRNO');
    if (index % 3 === 2 && row.outcome === 'DENIED') fail('XPC_CLOSE_STATUS');
  }
  for (const index of [0, 3, 6, 9, 12]) {
    const first = rows[index].outcome;
    if (first === 'NOT_RUN') fail('XPC_DEPENDENCY');
    for (const row of rows.slice(index + 1, index + 3)) {
      if ((first === 'ALLOWED') === (row.outcome === 'NOT_RUN')) fail('XPC_DEPENDENCY');
    }
  }
}

export function parseFixedXpcReply(bytes, expected) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 122 || bytes.length > 1145) fail('XPC_REPLY_BYTES');
  if (!record(expected) || !run(expected.runId) || !pid(expected.callerPid) || !home(expected.expectedHome)) fail('XPC_EXPECTED');
  if (!bytes.subarray(0, 4).equals(Buffer.from('NRS1')) ||
      !bytes.subarray(4, 36).equals(Buffer.from(expected.runId)) ||
      bytes.readUInt32BE(36) !== expected.callerPid) fail('XPC_REPLY_IDENTITY');
  const servicePidSelfReported = bytes.readUInt32BE(40);
  if (!pid(servicePidSelfReported) || servicePidSelfReported === expected.callerPid) fail('XPC_SERVICE_PID');
  const length = bytes.readUInt16BE(44);
  if (length < 1 || length > 1024 || bytes.length !== 121 + length) fail('XPC_REPLY_LENGTH');
  const decodedHome = decodeUtf8(bytes.subarray(46, 46 + length));
  if (decodedHome !== expected.expectedHome) fail('XPC_REPLY_HOME');
  const rows = OPERATIONS.map((operation, index) => ({ operation,
    outcome: OUTCOMES[bytes[46 + length + index * 5]],
    errno: bytes.readUInt32BE(47 + length + index * 5),
  }));
  validateRows(rows);
  return freeze({ runId: expected.runId, callerPid: expected.callerPid, servicePidSelfReported, home: decodedHome, rows });
}

export function parseFixedXpcClient(bytes, expected) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 16384) fail('XPC_CLIENT_BYTES');
  if (!record(expected) || !run(expected.runId) || !pid(expected.expectedPid) ||
      !home(expected.expectedClientHome) || !home(expected.expectedServiceHome)) fail('XPC_EXPECTED');
  const text = decodeUtf8(bytes);
  if (!text.endsWith('\n') || text.split('\n').length !== 2) fail('XPC_CLIENT_LINES');
  let value;
  try { value = JSON.parse(text); } catch { fail('XPC_CLIENT_JSON'); }
  if (!record(value) || Object.keys(value).sort().join('|') !== CLIENT_KEYS.join('|')) fail('XPC_CLIENT_KEYS');
  // Native emitter uses sorted keys and does not escape slashes. Byte equality
  // rejects duplicate/escaped keys, leading/trailing JSON data and lexical aliases.
  const canonical = JSON.stringify(Object.fromEntries(CLIENT_KEYS.map(key => [key, value[key]]))) + '\n';
  if (text !== canonical) fail('XPC_CLIENT_CANONICAL');
  if (value.schemaVersion !== 'nisi-fixed-xpc-client-v1' || value.runId !== expected.runId ||
      value.pid !== expected.expectedPid || value.home !== expected.expectedClientHome || value.authorizing !== false ||
      !CLIENT_STATUSES.includes(value.status) || typeof value.replyBase64 !== 'string') fail('XPC_CLIENT_IDENTITY');
  let reply = null;
  if (value.status === 'REPLY_RECEIVED') {
    const raw = Buffer.from(value.replyBase64, 'base64');
    if (raw.toString('base64') !== value.replyBase64) fail('XPC_CLIENT_BASE64');
    reply = parseFixedXpcReply(raw, { runId: expected.runId, callerPid: expected.expectedPid, expectedHome: expected.expectedServiceHome });
  } else if (value.replyBase64 !== '') fail('XPC_CLIENT_FAILED_REPLY');
  return freeze({ client: value, reply });
}

export function assertFixedXpcOutcomes(parsed) {
  if (!record(parsed)) fail('XPC_OUTCOMES');
  validateRows(parsed.rows);
  const expect = (index, outcome) => { if (parsed.rows[index].outcome !== outcome) fail('XPC_UNEXPECTED_OPERATION'); };
  for (let i = 0; i < 6; i++) expect(i, 'ALLOWED');
  for (const i of [6, 9]) expect(i, 'DENIED');
  for (const i of [7, 8, 10, 11]) expect(i, 'NOT_RUN');
  if (parsed.rows[12].outcome === 'DENIED') {
    expect(13, 'NOT_RUN'); expect(14, 'NOT_RUN');
  } else {
    expect(12, 'ALLOWED'); expect(13, 'DENIED'); expect(14, 'ALLOWED');
  }
}
