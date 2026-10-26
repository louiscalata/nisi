import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTypedContributionCombiner } from '../neural/typed-contribution-combiner.mjs';
import { fixtureBytes, resealFixture } from '../neural/bn01-fixture.mjs';
import { canonicalFixtureBytes, sealDualFixture } from '../neural/dual-face-fixture.mjs';
import { typedContext } from './fixtures/typed-context.mjs';
const c = x => fixtureBytes(x).toString('utf8');
const sha = x => createHash('sha256').update(x).digest('hex');
function rig(options = {}) {
  const ctx = typedContext(); let now = 0, reads = 0;
  const result = createTypedContributionCombiner(ctx.baseBytes, ctx.dualBytes,
    { generation: 7, clock: () => { reads++; return now; }, ...options });
  assert.equal(result.ok, true);
  const combiner = result.combiner;
  const contributor = (id = 'c1') => c({ kind: 'veritas-typed-contribution-contributor-v1', contributorId: id,
    role: 'worker', revision: 1, outputType: 'F32', outputWidth: 1, spaceSha256: sha('space'), maxPayloadBytes: 16 });
  const task = (over = {}) => c({ kind: 'veritas-typed-contribution-task-v1', taskId: 't1', requester: 'PRIMARY',
    ...ctx.pins, generation: 7, requiredContributors: ['c1'], deadlineMs: 10, ...over });
  const response = (text = task(), payload = Buffer.from([0, 0, 128, 63]), id = 'c1') => {
    const value = JSON.parse(text);
    return { text: c({ kind: 'veritas-typed-contribution-response-v1', contributorId: id, taskId: value.taskId,
      taskDigest: sha('veritas/typed-contribution/veritas-typed-contribution-task-v1\0' + text),
      outcome: 'RESPONSE_OK', payloadSha256: sha(payload) }), payload };
  };
  const ready = (text = task()) => {
    assert.equal(combiner.admitContributor(contributor()).ok, true);
    assert.equal(combiner.admitTask(text).ok, true);
    return response(text);
  };
  return { ...ctx, combiner, contributor, task, response, ready, setTime: value => { now = value; }, reads: () => reads };
}

test('typed factory refuses forged and resealed semantically invalid graph metadata', () => {
  for (const mode of ['digest', 'semantic', 'noncanonical', 'dual']) {
    const ctx = typedContext();
    let a = ctx.baseBytes, b = ctx.dualBytes;
    if (mode === 'digest') { ctx.base.graph.sha256 = 'f'.repeat(64); a = fixtureBytes(ctx.base); }
    if (mode === 'semantic') { ctx.base.graph.record.executionOrder.reverse(); resealFixture(ctx.base); a = fixtureBytes(ctx.base); }
    if (mode === 'noncanonical') a = Buffer.from(JSON.stringify(ctx.base, null, 2));
    if (mode === 'dual') { ctx.dual.topology.record.baseGraphSha256 = 'f'.repeat(64); sealDualFixture(ctx.dual); b = canonicalFixtureBytes(ctx.dual); }
    assert.equal(createTypedContributionCombiner(a, b, { generation: 7 }).ok, false, mode);
  }
});
test('all four foreign task pins and generation are refused at admission without consuming task ID', () => {
  for (const key of ['graphSha256', 'runSha256', 'topologySha256', 'planSha256', 'generation']) {
    const r = rig(); r.combiner.admitContributor(r.contributor());
    assert.equal(r.combiner.admitTask(r.task({ [key]: key === 'generation' ? 8 : 'f'.repeat(64) })).code,
      key === 'generation' ? 'TASK_GENERATION_MISMATCH' : 'TASK_IDENTITY_MISMATCH');
    assert.equal(r.combiner.admitTask(r.task()).code, 'TASK_ADMITTED');
  }
});
test('response expiry is exact, releases payloads, and retains task replay refusal', () => {
  const r = rig(); const entry = r.ready();
  assert.equal(r.combiner.admitResponse(entry.text, entry.payload).ok, true);
  r.setTime(10);
  assert.equal(r.combiner.admitResponse(entry.text, entry.payload).code, 'TASK_EXPIRED');
  assert.equal(r.combiner.status().retainedPayloadBytes, 0);
  assert.equal(r.combiner.admitTask(r.task()).code, 'TASK_DUPLICATE');
  assert.equal(r.combiner.combine(r.task(), [entry]).code, 'TASK_EXPIRED');
});
test('combine succeeds immediately before expiry, exactly once, then releases payloads', () => {
  const r = rig(); const entry = r.ready(); r.combiner.admitResponse(entry.text, entry.payload);
  r.setTime(9);
  assert.equal(r.combiner.combine(r.task(), [entry]).code, 'TYPED_COMBINE_COMPLETE');
  assert.equal(r.combiner.combine(r.task(), [entry]).code, 'TASK_CONSUMED');
  assert.equal(r.combiner.admitResponse(entry.text, entry.payload).code, 'TASK_CONSUMED');
  assert.equal(r.combiner.status().retainedPayloadBytes, 0);
});
test('contributors and retained task IDs have finite caps; failed calls do not spend capacity', () => {
  const r = rig({ maxContributors: 1, maxTasks: 1 });
  assert.equal(r.combiner.admitContributor(r.contributor()).ok, true);
  assert.equal(r.combiner.admitContributor(r.contributor()).code, 'CONTRIBUTOR_DUPLICATE');
  assert.equal(r.combiner.admitContributor(r.contributor('c2')).code, 'CONTRIBUTOR_CAP_EXHAUSTED');
  assert.equal(r.combiner.admitTask(r.task({ generation: 8 })).ok, false);
  assert.equal(r.combiner.admitTask(r.task()).ok, true);
  assert.equal(r.combiner.admitTask(r.task({ taskId: 't2' })).code, 'TASK_CAP_EXHAUSTED');
});
test('aggregate payload cap is enforced and restored after terminal combination', () => {
  const r = rig({ maxRetainedPayloadBytes: 4 });
  const e1 = r.ready(); const t2 = r.task({ taskId: 't2' }), e2 = r.response(t2);
  r.combiner.admitTask(t2);
  assert.equal(r.combiner.admitResponse(e1.text, e1.payload).ok, true);
  assert.equal(r.combiner.admitResponse(e2.text, e2.payload).code, 'PAYLOAD_CAP_EXHAUSTED');
  assert.equal(r.combiner.combine(r.task(), [e1]).ok, true);
  assert.equal(r.combiner.admitResponse(e2.text, e2.payload).ok, true);
});
test('bad clocks terminally refuse, never throw, and do not enable later delivery', () => {
  for (const value of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, '3', null]) {
    const r = rig(); const e = r.ready(); r.setTime(value);
    assert.equal(r.combiner.admitResponse(e.text, e.payload).code, 'CLOCK_REFUSED');
    assert.equal(r.combiner.admitTask(r.task()).code, 'OFF');
  }
  const ctx = typedContext();
  const r = createTypedContributionCombiner(ctx.baseBytes, ctx.dualBytes, { generation: 7, clock: () => { throw Error('clock'); } });
  assert.equal(r.combiner.admitContributor('{}').code, 'CLOCK_REFUSED');
});
test('clock rollback refuses and equal readings remain valid; one read per mutator', () => {
  const r = rig(); const entry = r.ready();
  assert.equal(r.reads(), 2);
  assert.equal(r.combiner.admitResponse(entry.text, entry.payload).ok, true);
  assert.equal(r.reads(), 3);
  r.setTime(2); assert.equal(r.combiner.admitTask(r.task({ taskId: 't2' })).ok, true);
  r.setTime(1); assert.equal(r.combiner.combine(r.task(), [entry]).code, 'CLOCK_REFUSED');
});
test('stop is terminal, idempotent, clears payloads and avoids further clock reads', () => {
  const r = rig(); const entry = r.ready(); r.combiner.admitResponse(entry.text, entry.payload);
  const reads = r.reads();
  assert.equal(r.combiner.stop().code, 'STOPPED'); assert.equal(r.combiner.stop().code, 'STOPPED');
  for (const result of [r.combiner.admitContributor(null), r.combiner.admitTask(null),
    r.combiner.admitResponse(null, null), r.combiner.combine(null, null)]) {
    assert.equal(result.code, 'OFF'); assert.equal(result.authorizing, false); assert.ok(Object.isFrozen(result));
  }
  assert.equal(r.combiner.status().retainedPayloadBytes, 0); assert.equal(r.reads(), reads);
});
test('clock callback cannot reenter mutators or stop the owner', () => {
  let combiner; const nested = [];
  const r = rig({ clock: () => {
    for (const f of [() => combiner.admitTask('{}'), () => combiner.admitContributor('{}'),
      () => combiner.admitResponse('{}', Buffer.alloc(1)), () => combiner.combine('{}', []), () => combiner.stop()]) nested.push(f().code);
    return 0;
  } });
  combiner = r.combiner;
  assert.equal(combiner.admitContributor(r.contributor()).ok, true);
  assert.deepEqual(nested, Array(5).fill('BUSY'));
});
test('bounded JSON intake rejects deeply nested, oversized and coercible input safely', () => {
  const r = rig();
  for (const input of ['['.repeat(100) + '0' + ']'.repeat(100), 'x'.repeat(65537),
    { toString() { throw Error('must not coerce'); } }]) {
    for (const f of [() => r.combiner.admitContributor(input), () => r.combiner.admitTask(input),
      () => r.combiner.admitResponse(input, Buffer.alloc(4)), () => r.combiner.combine(input, [])]) {
      assert.doesNotThrow(() => assert.equal(f().ok, false));
    }
  }
});
test('Float32 overflow created by rounding is refused; failed combination remains retryable', () => {
  const r = rig(); r.combiner.admitContributor(r.contributor()); r.combiner.admitContributor(r.contributor('c2'));
  const text = r.task({ requiredContributors: ['c1', 'c2'] }); r.combiner.admitTask(text);
  const payload = Buffer.alloc(4); payload.writeFloatLE(3e38);
  const entries = ['c1', 'c2'].map(id => r.response(text, payload, id));
  entries.forEach(e => assert.equal(r.combiner.admitResponse(e.text, e.payload).ok, true));
  assert.equal(r.combiner.combine(text, entries).code, 'COMBINED_NONFINITE_REFUSED');
  assert.equal(r.combiner.combine(text, entries).code, 'COMBINED_NONFINITE_REFUSED');
});

test('same-shaped responses from different declared data spaces cannot combine', () => {
  const r = rig(); r.combiner.admitContributor(r.contributor());
  const foreign = JSON.parse(r.contributor('c2')); foreign.spaceSha256 = sha('foreign-space');
  r.combiner.admitContributor(c(foreign));
  const text = r.task({ requiredContributors: ['c1', 'c2'] }); r.combiner.admitTask(text);
  const entries = ['c1', 'c2'].map(id => r.response(text, undefined, id));
  entries.forEach(e => assert.equal(r.combiner.admitResponse(e.text, e.payload).ok, true));
  assert.equal(r.combiner.combine(text, entries).code, 'SPACE_MISMATCH');
  assert.equal(r.combiner.status().retainedPayloadBytes, 8);
});

test('combine snapshots entries and their properties exactly once under the busy guard', () => {
  const r = rig(); const e = r.ready(); r.combiner.admitResponse(e.text, e.payload);
  let indexReads = 0, textReads = 0, payloadReads = 0;
  const entries = [];
  Object.defineProperty(entries, 0, { get() {
    indexReads++;
    assert.equal(r.combiner.stop().code, 'BUSY');
    return { get text() { textReads++; return e.text; }, get payload() { payloadReads++; return e.payload; } };
  } });
  assert.equal(r.combiner.combine(r.task(), entries).code, 'TYPED_COMBINE_COMPLETE');
  assert.deepEqual([indexReads, textReads, payloadReads], [1, 1, 1]);
});

test('an admitted response for another task cannot be borrowed for the current task', () => {
  const r = rig(); const e1 = r.ready();
  const t2 = r.task({ taskId: 't2' }), e2 = r.response(t2);
  r.combiner.admitTask(t2); r.combiner.admitResponse(e2.text, e2.payload);
  assert.equal(r.combiner.combine(r.task(), [e2]).code, 'RESPONSE_TASK_MISMATCH');
  assert.equal(r.combiner.status().retainedPayloadBytes, 4);
  r.combiner.admitResponse(e1.text, e1.payload);
  assert.equal(r.combiner.combine(r.task(), [e1]).ok, true);
  assert.equal(r.combiner.combine(t2, [e2]).ok, true);
});

test('throwing getters and wrong count do not consume the task; owned payload can still combine', () => {
  const r = rig(); const e = r.ready(), original = Buffer.from(e.payload);
  r.combiner.admitResponse(e.text, e.payload); e.payload.fill(0);
  for (const entry of [{ get text() { throw Error('text'); } },
    { text: e.text, get payload() { throw Error('payload'); } }]) {
    assert.equal(r.combiner.combine(r.task(), [entry]).code, 'OPERATION_REFUSED');
  }
  assert.equal(r.combiner.combine(r.task(), []).code, 'RESPONSE_COUNT_MISMATCH');
  assert.equal(r.combiner.status().retainedPayloadBytes, 4);
  assert.equal(r.combiner.combine(r.task(), [{ text: e.text, payload: original }]).ok, true);
});

test('expiry sweep releases every payload exactly once and task tombstones retain the ID cap', () => {
  const r = rig({ maxTasks: 2 }); const e = r.ready();
  r.combiner.admitResponse(e.text, e.payload);
  const t2 = r.task({ taskId: 't2' }), e2 = r.response(t2);
  r.combiner.admitTask(t2); r.combiner.admitResponse(e2.text, e2.payload);
  r.setTime(10);
  assert.equal(r.combiner.admitTask(r.task({ taskId: 't3' })).code, 'TASK_CAP_EXHAUSTED');
  assert.equal(r.combiner.status().retainedPayloadBytes, 0);
  assert.equal(r.combiner.status().retainedResponses, 0);
  assert.equal(r.combiner.combine(t2, [e2]).code, 'TASK_EXPIRED');
  assert.equal(r.combiner.status().retainedPayloadBytes, 0);
  assert.equal(r.combiner.status().retainedTasks, 2);
});

test('factory owns declaration snapshots and refuses invalid capacity, clock and byte inputs', () => {
  const r = rig(); r.baseBytes.fill(0); r.dualBytes.fill(0);
  const e = r.ready(); r.combiner.admitResponse(e.text, e.payload);
  assert.equal(r.combiner.combine(r.task(), [e]).ok, true);
  const ctx = typedContext();
  for (const key of ['maxTasks', 'maxContributors', 'maxRetainedPayloadBytes']) {
    for (const value of [-1, 0, 1.5, Infinity, '1', Number.MAX_SAFE_INTEGER]) {
      assert.equal(createTypedContributionCombiner(ctx.baseBytes, ctx.dualBytes,
        { generation: 7, [key]: value }).code, 'LIMITS_REFUSED');
    }
  }
  assert.equal(createTypedContributionCombiner(ctx.baseBytes, ctx.dualBytes, { generation: 7, clock: 0 }).code, 'CLOCK_REFUSED');
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(262145), Buffer.from(new SharedArrayBuffer(16))]) {
    assert.equal(createTypedContributionCombiner(bytes, ctx.dualBytes, { generation: 7 }).ok, false);
  }
});

test('clock failure clears retained state and deadline addition cannot overflow', () => {
  const r = rig(); const e = r.ready(); r.combiner.admitResponse(e.text, e.payload);
  r.setTime(NaN);
  assert.equal(r.combiner.combine(r.task(), [e]).code, 'CLOCK_REFUSED');
  const status = r.combiner.status();
  assert.deepEqual([status.contributors, status.retainedTasks, status.retainedResponses, status.retainedPayloadBytes], [0, 0, 0, 0]);
  const other = rig(); other.combiner.admitContributor(other.contributor()); other.setTime(Number.MAX_SAFE_INTEGER - 1);
  assert.equal(other.combiner.admitTask(other.task()).code, 'DEADLINE_OVERFLOW');
  assert.equal(other.combiner.status().retainedTasks, 0);
});

test('post-stop combination never accesses caller getters', () => {
  const r = rig(); r.combiner.stop(); let reads = 0;
  const entries = [];
  Object.defineProperty(entries, 0, { get() { reads++; throw Error('must not read'); } });
  assert.equal(r.combiner.combine(r.task(), entries).code, 'OFF'); assert.equal(reads, 0);
});
