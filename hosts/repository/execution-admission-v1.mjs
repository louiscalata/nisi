// nisi execution admission decision — pure function over injected snapshots

const NOT_EVALUATED = 'NOT_EVALUATED';
const OK = 'OK';

function makeResult(status, reason, checks) {
  Object.freeze(checks);
  return Object.freeze({
    schemaVersion: 'nisi-execution-admission/v1',
    status,
    reason,
    checks,
    authorizing: false,
    executionGranted: false
  });
}

function invalidInput() {
  return makeResult('REFUSE', 'INVALID_INPUT', {
    consent: NOT_EVALUATED,
    scheduler: NOT_EVALUATED,
    capacity: NOT_EVALUATED,
    host: NOT_EVALUATED
  });
}

function isPlainDataObject(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  // Reflect.ownKeys sees symbol-keyed and non-enumerable own properties too; a
  // count of Object.keys would let a hidden extra ride through (Track 5 review D2).
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length) {
    return false;
  }
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (!own.includes(key)) {
      return false;
    }
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc.enumerable || typeof desc.get !== 'undefined' || typeof desc.set !== 'undefined') {
      return false;
    }
  }
  return true;
}

function isNonNegativeSafeInt(v) {
  return Number.isSafeInteger(v) && v >= 0;
}

export function decideExecutionAdmission(input) {
  // exact top-level shape, all own enumerable data properties
  if (!isPlainDataObject(input, ['now', 'consent', 'scheduler', 'capacity', 'host', 'request'])) {
    return invalidInput();
  }

  const now = input.now;
  if (!Number.isSafeInteger(now) || now < 0 || Object.is(now, -0)) {
    return invalidInput();
  }

  const request = input.request;
  if (!isPlainDataObject(request, ['priority', 'ownerId'])) {
    return invalidInput();
  }
  if (request.priority !== 'FOREGROUND' && request.priority !== 'BACKGROUND') {
    return invalidInput();
  }
  if (typeof request.ownerId !== 'string' || request.ownerId.length === 0) {
    return invalidInput();
  }

  const consent = input.consent;
  if (consent !== null && consent !== undefined) {
    if (!isPlainDataObject(consent, ['grantedAtMs', 'expiresAtMs', 'revoked', 'scope'])) {
      return invalidInput();
    }
    if (!Number.isSafeInteger(consent.grantedAtMs) || !Number.isSafeInteger(consent.expiresAtMs)) {
      return invalidInput();
    }
    if (typeof consent.revoked !== 'boolean' || typeof consent.scope !== 'string') {
      return invalidInput();
    }
    if (consent.grantedAtMs > now) {
      return invalidInput();
    }
  }

  const scheduler = input.scheduler;
  if (!isPlainDataObject(scheduler, ['decision', 'observedAtMs', 'freshnessMs', 'queueState'])) {
    return invalidInput();
  }
  if (
    scheduler.decision !== 'ALLOW' &&
    scheduler.decision !== 'WINDOW_FULL' &&
    scheduler.decision !== 'COURIER_RESERVED' &&
    scheduler.decision !== 'COURIER_BUDGET_EXHAUSTED' &&
    scheduler.decision !== 'INPUT_INVALID'
  ) {
    return invalidInput();
  }
  if (!Number.isSafeInteger(scheduler.observedAtMs)) {
    return invalidInput();
  }
  if (!Number.isSafeInteger(scheduler.freshnessMs) || scheduler.freshnessMs < 1) {
    return invalidInput();
  }
  if (scheduler.queueState !== 'ACTIVE' && scheduler.queueState !== 'OFF') {
    return invalidInput();
  }

  const capacity = input.capacity;
  if (!isPlainDataObject(capacity, ['configuredSlots', 'measuredFreeSlots', 'measuredAtMs', 'freshnessMs'])) {
    return invalidInput();
  }
  if (!isNonNegativeSafeInt(capacity.configuredSlots)) {
    return invalidInput();
  }
  if (
    capacity.measuredFreeSlots !== null &&
    (!isNonNegativeSafeInt(capacity.measuredFreeSlots) || capacity.measuredFreeSlots > capacity.configuredSlots)
  ) {
    return invalidInput();
  }
  if (!Number.isSafeInteger(capacity.measuredAtMs)) {
    return invalidInput();
  }
  if (!Number.isSafeInteger(capacity.freshnessMs) || capacity.freshnessMs < 1) {
    return invalidInput();
  }

  const host = input.host;
  if (!isPlainDataObject(host, ['state', 'pendingTransports', 'observedAtMs'])) {
    return invalidInput();
  }
  if (
    host.state !== 'IDLE' &&
    host.state !== 'BUSY' &&
    host.state !== 'QUARANTINED' &&
    host.state !== 'OFF' &&
    host.state !== 'TIMEOUT' &&
    host.state !== 'CANCELLED'
  ) {
    return invalidInput();
  }
  if (!isNonNegativeSafeInt(host.pendingTransports)) {
    return invalidInput();
  }
  if (!Number.isSafeInteger(host.observedAtMs)) {
    return invalidInput();
  }

  // input is valid; run the fixed-order decision
  const checks = {
    consent: NOT_EVALUATED,
    scheduler: NOT_EVALUATED,
    capacity: NOT_EVALUATED,
    host: NOT_EVALUATED
  };

  if (consent === null || consent === undefined) {
    checks.consent = 'CONSENT_MISSING';
    return makeResult('REFUSE', 'CONSENT_MISSING', checks);
  }
  if (consent.expiresAtMs <= now) {
    checks.consent = 'CONSENT_EXPIRED';
    return makeResult('REFUSE', 'CONSENT_EXPIRED', checks);
  }
  if (consent.revoked === true) {
    checks.consent = 'CONSENT_REVOKED';
    return makeResult('REFUSE', 'CONSENT_REVOKED', checks);
  }
  if (consent.scope !== 'execute') {
    checks.consent = 'CONSENT_SCOPE';
    return makeResult('REFUSE', 'CONSENT_SCOPE', checks);
  }
  checks.consent = OK;

  if (now - scheduler.observedAtMs >= scheduler.freshnessMs) {
    checks.scheduler = 'SCHEDULER_STALE';
    return makeResult('REFUSE', 'SCHEDULER_STALE', checks);
  }
  if (scheduler.queueState !== 'ACTIVE') {
    checks.scheduler = 'QUEUE_NOT_ACTIVE';
    return makeResult('REFUSE', 'QUEUE_NOT_ACTIVE', checks);
  }
  if (scheduler.decision !== 'ALLOW') {
    checks.scheduler = scheduler.decision;
    return makeResult('REFUSE', 'SCHEDULER_REFUSED', checks);
  }
  checks.scheduler = OK;

  if (capacity.measuredFreeSlots === null) {
    checks.capacity = 'CAPACITY_UNMEASURED';
    return makeResult('REFUSE', 'CAPACITY_UNMEASURED', checks);
  }
  if (now - capacity.measuredAtMs >= capacity.freshnessMs) {
    checks.capacity = 'CAPACITY_STALE';
    return makeResult('REFUSE', 'CAPACITY_STALE', checks);
  }
  if (capacity.measuredFreeSlots === 0) {
    checks.capacity = 'CAPACITY_EXHAUSTED';
    return makeResult('REFUSE', 'CAPACITY_EXHAUSTED', checks);
  }
  checks.capacity = OK;

  if (now - host.observedAtMs >= 5000) {
    checks.host = 'HOST_STALE';
    return makeResult('REFUSE', 'HOST_STALE', checks);
  }
  if (host.pendingTransports > 0) {
    checks.host = host.state;
    if (host.state === 'OFF' || host.state === 'TIMEOUT' || host.state === 'CANCELLED') {
      return makeResult('DRAIN_UNCONFIRMED', 'TRANSPORTS_PENDING', checks);
    }
    return makeResult('REFUSE', 'TRANSPORTS_PENDING', checks);
  }
  if (host.state !== 'IDLE') {
    checks.host = host.state;
    return makeResult('REFUSE', 'HOST_NOT_IDLE', checks);
  }
  checks.host = OK;

  return makeResult('ADMIT', null, checks);
}
