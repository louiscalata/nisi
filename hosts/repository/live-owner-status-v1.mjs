// PRIVATE status translation only. It grants neither admission nor remote-stop proof.
const fail = code => { throw Object.assign(new Error(code), { code }); };
export function liveModelOwnerStatusV1(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('LIVE_EXECUTION_MODEL_STATE');
  const d = Object.getOwnPropertyDescriptors(value);
  for (const key of ['state', 'pendingTransports', 'recoveryRequired'])
    if (!d[key]?.enumerable || !Object.hasOwn(d[key], 'value')) fail('LIVE_EXECUTION_MODEL_STATE');
  const state = d.state.value, pending = d.pendingTransports.value, recovery = d.recoveryRequired.value;
  if (!['IDLE', 'BUSY', 'DRAINING', 'STOPPED_DRAINING', 'STOPPED', 'QUARANTINED'].includes(state) ||
      !Number.isSafeInteger(pending) || pending < 0 || typeof recovery !== 'boolean') fail('LIVE_EXECUTION_MODEL_STATE');
  // A stopped local owner can still require recovery. Never erase quarantine.
  if (recovery || state === 'QUARANTINED') return 'QUARANTINED';
  if (pending > 0 || ['BUSY', 'DRAINING', 'STOPPED_DRAINING'].includes(state)) return 'BUSY';
  return state === 'STOPPED' ? 'OFF' : 'IDLE';
}
export function liveHostOwnerStatusV1(state) {
  if (['NEW', 'RUNNING', 'SETTLING'].includes(state)) return 'BUSY';
  if (state === 'SETTLED') return 'IDLE';
  if (state === 'QUARANTINED') return 'QUARANTINED';
  fail('LIVE_EXECUTION_HOST_STATE');
}
