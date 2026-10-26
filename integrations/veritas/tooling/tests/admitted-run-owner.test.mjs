// Deterministic contract tests for the admitted-run owner (BN01-C09 / C05 flavor).
// Dependency-free: node:test only, same file style as the other tooling suites.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdmittedRunOwner } from '../neural/admitted-run-owner.mjs';

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const PINS = { graphSha256: 'a'.repeat(64), runSha256: 'b'.repeat(64),
  topologySha256: 'c'.repeat(64), planSha256: 'd'.repeat(64) };
const newBind = overrides => canonical({ kind: 'veritas-admitted-run-bind-v1',
  profile: 'veritas-bn01-offline-contract-v1', schemaVersion: 1, generation: 1,
  runBudgetCap: 10, deadlineMs: 60000, ...PINS, ...overrides });
const newRequest = overrides => canonical({ kind: 'veritas-admitted-run-permit-request-v1',
  runId: 'run-alpha', requester: 'PRIMARY', generation: 1, scope: 'contribution', ...overrides });
const newPermit = (permitId, overrides = {}) => canonical({ kind: 'veritas-admitted-run-permit-v1',
  permitId, runId: 'run-alpha', requester: 'PRIMARY', generation: 1, scope: 'contribution', ...PINS, ...overrides });
const newExec = (permitId, overrides = {}) => canonical({ kind: 'veritas-admitted-run-execution-v1',
  permitId, runId: 'run-alpha', requester: 'PRIMARY', generation: 1, scope: 'contribution', ...PINS, ...overrides });

let time = 0;
const clock = () => time;
const bind = (bindBytes = newBind(), options = {}) => createAdmittedRunOwner(Buffer.from(bindBytes, 'utf8'), { clock, ...options });

test('factory binds a bounded run-identity declaration and returns the owner', () => {
  const r = bind();
  assert.equal(r.ok, true);
  assert.equal(r.code, 'READY_PRIVATE_ADMITTED_RUN_OWNER_ONLY');
  assert.equal(r.authorizing, false);
  const s = r.owner.status();
  assert.equal(s.ok, true);
  assert.equal(s.admitted, 0);
  assert.equal(s.executionsUsed, 0);
});

test('factory refuses invalid declaration bytes or a bad generation', () => {
  assert.equal(bind(newBind({ generation: 0 })).ok, false);
  assert.equal(bind(newBind({ runBudgetCap: 0 })).ok, false);
  assert.equal(bind(newBind({ deadlineMs: 0 })).ok, false);
  assert.equal(bind(newBind({ kind: 'veritas-admitted-run-bind-v2' })).ok, false);
  assert.equal(bind(newBind({ profile: 'other' })).ok, false);
  assert.equal(bind(newBind({ ...PINS, runSha256: 'zz' })).ok, false);
  assert.equal(bind(Buffer.from('{bad json', 'utf8')).ok, false);
  assert.equal(bind(Buffer.from([])).ok, false);
});

test('a declared run acquires the single admitted-run permit for this generation', () => {
  const r = bind();
  assert.equal(r.ok, true);
  const p = r.owner.requestPermit(newRequest());
  assert.equal(p.ok, true);
  assert.equal(p.code, 'PERMIT_ISSUED');
  assert.equal(p.runId, 'run-alpha');
  assert.equal(typeof p.digest, 'string');
  assert.equal(p.digest.length, 64);
});

test('a second permit while one is live is refused (single admitted run)', () => {
  const r = bind();
  assert.equal(r.owner.requestPermit(newRequest()).ok, true);
  assert.equal(r.owner.requestPermit(newRequest({ runId: 'run-beta' })).ok, false);
  assert.equal(r.owner.requestPermit(newRequest({ runId: 'run-beta' })).code, 'RUN_ALREADY_ADMITTED');
});

test('a one-use permit admits one execution and refuses the second (late output)', () => {
  const r = bind();
  const p = r.owner.requestPermit(newRequest());
  const e1 = r.owner.checkExecution(newExec(p.permitId));
  assert.equal(e1.ok, true);
  assert.equal(e1.code, 'ADMITTED');
  assert.equal(e1.executionsUsed, 1);
  assert.equal(e1.authorizing, false);
  const e2 = r.owner.checkExecution(newExec(p.permitId));
  assert.equal(e2.ok, false);
  assert.equal(e2.code, 'LATE_OUTPUT_REFUSED');
  assert.equal(r.owner.status().executionsUsed, 1);
});

test('an execution without a matching permit is refused with zero work', () => {
  const r = bind();
  r.owner.requestPermit(newRequest());
  const e = r.owner.checkExecution(newExec('permit-nope'));
  assert.equal(e.ok, false);
  assert.equal(e.code, 'PERMIT_ABSENT');
  assert.equal(r.owner.status().executionsUsed, 0);
});

test('revocation invalidates the permit and refuses every later execution', () => {
  const r = bind();
  const p = r.owner.requestPermit(newRequest());
  assert.equal(r.owner.revoke(p.permitId).code, 'PERMIT_REVOKED');
  const e = r.owner.checkExecution(newExec(p.permitId));
  assert.equal(e.ok, false);
  assert.equal(e.code, 'PERMIT_REVOKED');
  assert.equal(r.owner.status().revoked, true);
});

test('after revocation the owner refuses further permit requests outright', () => {
  const r = bind();
  const p = r.owner.requestPermit(newRequest());
  r.owner.revoke(p.permitId);
  const p2 = r.owner.requestPermit(newRequest({ runId: 'run-gamma' }));
  assert.equal(p2.ok, false);
  assert.equal(p2.code, 'OWNER_REVOKED');
});

test('a stale permit is refused after its window expires', () => {
  const r = bind(newBind({ deadlineMs: 1000 }));
  const p = r.owner.requestPermit(newRequest());
  assert.equal(r.owner.checkExecution(newExec(p.permitId)).ok, true);
  time = 0;
  const r2 = bind(newBind({ deadlineMs: 1000 }));
  const p2 = r2.owner.requestPermit(newRequest());
  time = 1001;
  const e = r2.owner.checkExecution(newExec(p2.permitId));
  assert.equal(e.ok, false);
  assert.equal(e.code, 'PERMIT_STALE');
  assert.equal(r2.owner.status().executionsUsed, 0);
});

test('a generation-mismatched execution is refused', () => {
  const r = bind();
  const p = r.owner.requestPermit(newRequest());
  const e = r.owner.checkExecution(newExec(p.permitId, { generation: 2 }));
  assert.equal(e.ok, false);
  assert.equal(e.code, 'EXECUTION_GENERATION_MISMATCH');
});

test('identity pin mismatches are refused, not admitted', () => {
  const r = bind();
  const p = r.owner.requestPermit(newRequest());
  const e = r.owner.checkExecution(newExec(p.permitId, { runSha256: 'e'.repeat(64) }));
  assert.equal(e.ok, false);
  assert.equal(e.code, 'EXECUTION_PIN_MISMATCH');
  const e2 = r.owner.checkExecution(newExec(p.permitId, { runId: 'run-other' }));
  assert.equal(e2.ok, false);
  assert.equal(e2.code, 'EXECUTION_IDENTITY_MISMATCH');
  assert.equal(r.owner.status().executionsUsed, 0);
});

test('a wrong-scope or non-PRIMARY execution cannot be admitted', () => {
  const r = bind();
  const p = r.owner.requestPermit(newRequest());
  assert.equal(r.owner.checkExecution(newExec(p.permitId, { scope: 'other' })).code, 'EXECUTION_IDENTITY_MISMATCH');
  const r2 = bind();
  assert.equal(r2.owner.requestPermit(newRequest({ requester: 'RELAY' })).ok, false);
  assert.equal(r2.owner.requestPermit(newRequest()).ok, true);
  const p2 = r2.owner.requestPermit(newRequest());
  assert.equal(r2.owner.checkExecution(newExec(p2.permitId, { requester: 'RELAY' })).ok, false);
});

test('non-canonical or malformed declare/execute text is refused, never a PASS', () => {
  const r = bind();
  const p = r.owner.requestPermit(newRequest());
  assert.equal(r.owner.checkExecution('{not json').ok, false);
  const ugly = newExec(p.permitId).replace(',"runId"', ',"runId" ');
  assert.equal(r.owner.checkExecution(ugly).ok, false);
  const r2 = bind();
  const shifted = newRequest().replace('"runId"', '"runId" ');
  assert.equal(r2.owner.requestPermit(shifted).ok, false);
  assert.equal(r2.owner.status().admitted, 0);
});

test('a permit request for the wrong generation is refused at mint', () => {
  const r = bind(newBind({ generation: 3 }));
  assert.equal(r.owner.requestPermit(newRequest({ generation: 3 })).ok, true);
  const r2 = bind(newBind({ generation: 3 }));
  assert.equal(r2.owner.requestPermit(newRequest({ generation: 2 })).ok, false);
  assert.equal(r2.owner.requestPermit(newRequest({ generation: 2 })).code, 'PERMIT_GENERATION_MISMATCH');
});

test('every outcome carries the frozen non-authorizing flags', () => {
  const r = bind();
  const p = r.owner.requestPermit(newRequest());
  const e = r.owner.checkExecution(newExec(p.permitId));
  for (const outcome of [r, p, e, r.owner.status(), r.owner.revoke(p.permitId)]) {
    assert.equal(outcome.authorizing, false);
    assert.equal(outcome.modelExecuted, false);
    assert.equal(outcome.promotionGranted, false);
    assert.equal(outcome.certificationGranted, false);
  }
});
test('a permit past its deadline is stale on the default path, with no injected clock', async () => {
  // #time() used to return a timestamp frozen at construction, making the
  // staleness test t0 > t0 + deadlineMs — false for every positive deadline —
  // so PERMIT_STALE could not fire unless a test injected a clock.
  const r = createAdmittedRunOwner(Buffer.from(newBind({ deadlineMs: 1 }), 'utf8'), {});
  assert.equal(r.ok, true);
  const p = r.owner.requestPermit(newRequest());
  assert.equal(p.code, 'PERMIT_ISSUED');
  await new Promise(resolve => setTimeout(resolve, 30));
  const e = r.owner.checkExecution(newExec(p.permitId));
  assert.equal(e.ok, false);
  assert.equal(e.code, 'PERMIT_STALE');
});

test('a non-function clock is refused at bind, never treated as no clock', () => {
  for (const bad of [12345, 'now', {}, []]) {
    assert.equal(createAdmittedRunOwner(Buffer.from(newBind(), 'utf8'), { clock: bad }).ok, false);
  }
  assert.equal(createAdmittedRunOwner(Buffer.from(newBind(), 'utf8'), { clock: null }).ok, true);
  assert.equal(createAdmittedRunOwner(Buffer.from(newBind(), 'utf8'), {}).ok, true);
});

test('the permit digest is reproducible from the request, not from when it was minted', async () => {
  // hash(permit) included issuedAtMs, so the same request produced a different
  // digest on every run and could not be compared or replayed.
  const mint = () => {
    const r = createAdmittedRunOwner(Buffer.from(newBind(), 'utf8'), {});
    return r.owner.requestPermit(newRequest());
  };
  const a = mint();
  await new Promise(resolve => setTimeout(resolve, 25));
  const b = mint();
  assert.equal(a.code, 'PERMIT_ISSUED');
  assert.equal(b.code, 'PERMIT_ISSUED');
  assert.equal(a.permitId, b.permitId);
  assert.equal(a.digest, b.digest);
});
