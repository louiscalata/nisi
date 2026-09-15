import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { withPreflightGuards } from './helpers/live-cli-side-effect-guard.mjs';

const cliURL = new URL('../examples/repository-live-model.mjs', import.meta.url);
const approvedArguments = ({ endpoint = 'http://127.0.0.1:1234/v1/chat/completions', authorModel = 'author-test', reviewerModel = 'reviewer-test' } = {}) => [
  '--approved-reviewed-fixture', '--endpoint', endpoint, '--author-model', authorModel, '--reviewer-model', reviewerModel,
];
const coded = code => Object.assign(new Error(code), { code });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const load = () => import(cliURL);

test('live CLI import is inert and exposes only explicitly invoked entry points', async () => {
  await withPreflightGuards(async ({ reads }) => {
    const cli = await load();
    for (const name of ['parseLiveDemoArguments', 'runPrivateLiveDemo', 'collectLiveHostEvidenceV1']) assert.equal(typeof cli[name], 'function');
    assert.deepEqual(reads, [], 'Import must not load fixture contents or start preflight');
  });
});

test('live CLI standalone help requires no approval, fixture reads, or execution', async () => {
  await withPreflightGuards(async ({ reads }) => {
    const { parseLiveDemoArguments, runPrivateLiveDemo } = await load();
    assert.equal(parseLiveDemoArguments(['--help']), null);
    const result = await runPrivateLiveDemo(['--help']);
    assert.equal(result.exitCode, 0);
    assert.match(result.help, /^PRIVATE ONLY:/);
    for (const flag of ['--approved-reviewed-fixture', '--endpoint', '--author-model', '--reviewer-model']) assert.ok(result.help.includes(flag), `Help must describe ${flag}`);
    assert.deepEqual(reads, []);
    await assert.rejects(runPrivateLiveDemo(['--help', '--approved-reviewed-fixture']), { code: 'LIVE_DEMO_ARGUMENTS' });
  });
});

test('live CLI parser returns immutable explicit configuration without running it', async () => {
  await withPreflightGuards(async ({ reads }) => {
    const { parseLiveDemoArguments } = await load();
    const args = approvedArguments(), copy = [...args];
    const result = parseLiveDemoArguments(args);
    assert.deepEqual(result, { endpoint: args[2], authorModel: args[4], reviewerModel: args[6] });
    assert.ok(Object.isFrozen(result));
    assert.deepEqual(args, copy, 'Parsing must not mutate caller arguments');
    assert.deepEqual(parseLiveDemoArguments([...args.slice(1), args[0]]), result, 'The explicit flag is order independent');
    assert.deepEqual(reads, []);
  });
});

test('live CLI refuses absent approval or incomplete selection before fixture access', async () => {
  await withPreflightGuards(async ({ reads }) => {
    const { runPrivateLiveDemo } = await load();
    for (const args of [[], approvedArguments().slice(1), ['--approved-reviewed-fixture'], ['--endpoint', 'http://127.0.0.1:1234/v1/chat/completions']]) {
      await assert.rejects(runPrivateLiveDemo(args), { code: 'LIVE_DEMO_EXPLICIT_APPROVAL_REQUIRED' });
    }
    assert.deepEqual(reads, []);
  });
});

test('live CLI rejects duplicate, unknown, missing, positional, and non-string arguments before fixture access', async () => {
  await withPreflightGuards(async ({ reads }) => {
    const { runPrivateLiveDemo } = await load();
    const cases = [
      null, {}, 'not-an-array', [4], [undefined], new Array(1),
      [...approvedArguments(), '--approved-reviewed-fixture'],
      [...approvedArguments(), '--endpoint', 'http://127.0.0.1:1234/other'],
      [...approvedArguments(), '--unknown'],
      ['--endpoint'], ['--endpoint', ''], ['--endpoint', '--author-model', 'a'],
      [...approvedArguments(), 'positional'], ['--approved-reviewed-fixture=true'],
    ];
    for (const args of cases) await assert.rejects(runPrivateLiveDemo(args), { code: 'LIVE_DEMO_ARGUMENTS' });
    assert.deepEqual(reads, []);
  });
});

test('live CLI refuses invalid and identical model IDs after only pinned source reads', async () => {
  await withPreflightGuards(async ({ reads, fixtureFiles }) => {
    const { runPrivateLiveDemo } = await load();
    const cases = [
      { authorModel: ' ' }, { authorModel: ' author-test' }, { reviewerModel: 'reviewer-test\n' },
      { authorModel: 'author\0test' }, { authorModel: '\ud800' }, { reviewerModel: 'x'.repeat(201) },
      { authorModel: 'same', reviewerModel: 'same', code: 'LIVE_MODELS_NOT_DISTINCT' },
    ];
    for (const { code = 'LIVE_MODEL_ID', ...selected } of cases) {
      const before = reads.length;
      await assert.rejects(runPrivateLiveDemo(approvedArguments(selected)), { code });
      assert.deepEqual(reads.slice(before).sort(), [...fixtureFiles].sort(), 'Refusal may read exactly the source-reviewed fixture, but cannot build or materialize');
    }
  }, { allowFixtureReads: true });
});

test('live CLI refuses invalid or non-loopback endpoints without build or transport side effects', async () => {
  await withPreflightGuards(async ({ reads, fixtureFiles }) => {
    const { runPrivateLiveDemo } = await load();
    const cases = [
      ['not-a-url', 'LOCAL_CHAT_ENDPOINT_INVALID'], ['http://' + 'x'.repeat(2050), 'LOCAL_CHAT_ENDPOINT_INVALID'],
      ['https://127.0.0.1:1234/v1/chat/completions', 'LOCAL_CHAT_DESTINATION_REFUSED'],
      ['http://localhost:1234/v1/chat/completions', 'LOCAL_CHAT_DESTINATION_REFUSED'],
      ['http://10.0.0.2:1234/v1/chat/completions', 'LOCAL_CHAT_DESTINATION_REFUSED'],
      ['http://user:password@127.0.0.1:1234/v1/chat/completions', 'LOCAL_CHAT_DESTINATION_REFUSED'],
      ['http://127.0.0.1:1234/v1/chat/completions?key=x', 'LOCAL_CHAT_DESTINATION_REFUSED'],
      ['http://127.0.0.1:1234/v1/chat/completions#fragment', 'LOCAL_CHAT_DESTINATION_REFUSED'],
    ];
    for (const [endpoint, code] of cases) {
      const before = reads.length;
      await assert.rejects(runPrivateLiveDemo(approvedArguments({ endpoint })), { code });
      assert.deepEqual(reads.slice(before).sort(), [...fixtureFiles].sort());
    }
  }, { allowFixtureReads: true });
});

test('live CLI report-retention failure still awaits pending host settlement and retains its result', async () => {
  await withPreflightGuards(async () => {
    const { collectLiveHostEvidenceV1 } = await load();
    const settlement = deferred(), report = Object.freeze({ workflowOutcome: 'PASS' });
    const hostResult = Object.freeze({ state: 'SETTLED', report }), events = [];
    let completed = false;
    const collection = collectLiveHostEvidenceV1({ settled() { events.push('settled called'); return settlement.promise; } }, report,
      async (name, value) => { events.push([name, value]); if (name === 'engine-report.json') throw coded('SYNTHETIC_REPORT_WRITE'); })
      .then(value => { completed = true; return value; });
    await tick();
    assert.equal(completed, false, 'Report storage failure must not bypass the pending settlement observation');
    assert.deepEqual(events, [['engine-report.json', report], 'settled called']);
    settlement.resolve(hostResult);
    const result = await collection;
    assert.equal(result.hostResult, hostResult);
    assert.deepEqual(result.errors, [{ stage: 'engine-report.json', code: 'SYNTHETIC_REPORT_WRITE' }]);
    assert.deepEqual(events, [['engine-report.json', report], 'settled called', ['host-result.json', hostResult]]);
  });
});

test('live CLI independent report and host-result retention failures preserve both errors', async () => {
  await withPreflightGuards(async () => {
    const { collectLiveHostEvidenceV1 } = await load();
    const report = Object.freeze({ workflowOutcome: 'BLOCKED' }), hostResult = Object.freeze({ state: 'SETTLED', report });
    const writes = []; let settledCalls = 0;
    const result = await collectLiveHostEvidenceV1({ async settled() { settledCalls++; return hostResult; } }, report, async (name, value) => {
      writes.push([name, value]); throw coded(name === 'engine-report.json' ? 'SYNTHETIC_REPORT_WRITE' : 'SYNTHETIC_HOST_WRITE');
    });
    assert.equal(settledCalls, 1);
    assert.equal(result.hostResult, hostResult);
    assert.deepEqual(writes, [['engine-report.json', report], ['host-result.json', hostResult]]);
    assert.deepEqual(result.errors, [{ stage: 'engine-report.json', code: 'SYNTHETIC_REPORT_WRITE' }, { stage: 'host-result.json', code: 'SYNTHETIC_HOST_WRITE' }]);
  });
});

test('live CLI rejected host settlement preserves the original engine report and does not invent a host result', async () => {
  await withPreflightGuards(async () => {
    const { collectLiveHostEvidenceV1 } = await load();
    const report = Object.freeze({ workflowOutcome: 'BLOCKED', errorCode: 'ORIGINAL_ENGINE_REASON' }), writes = [];
    const result = await collectLiveHostEvidenceV1({ async settled() { throw coded('SYNTHETIC_SETTLEMENT'); } }, report,
      async (name, value) => { writes.push([name, value]); });
    assert.equal(result.hostResult, null);
    assert.deepEqual(result.errors, [{ stage: 'host.settled', code: 'SYNTHETIC_SETTLEMENT' }]);
    assert.deepEqual(writes, [['engine-report.json', report]]);
    assert.equal(writes[0][1], report, 'Storage keeps the actual original engine report, not a fabricated settlement failure report');
    assert.equal(report.errorCode, 'ORIGINAL_ENGINE_REASON');
  });
});

test('live CLI settlement timeout stays unconfirmed and cannot produce a fake settled host result', async () => {
  await withPreflightGuards(async () => {
    const { collectLiveHostEvidenceV1 } = await load();
    const report = Object.freeze({ workflowOutcome: 'BLOCKED' }), writes = [];
    let settledCalls = 0;
    const result = await collectLiveHostEvidenceV1({ settled() { settledCalls++; return new Promise(() => {}); } }, report,
      async (name, value) => { writes.push([name, value]); }, { settlementTimeoutMs: 1 });
    assert.equal(settledCalls, 1);
    assert.equal(result.hostResult, null);
    assert.deepEqual(result.errors, [{ stage: 'host.settled', code: 'LIVE_DEMO_HOST_SETTLEMENT_UNCONFIRMED' }]);
    assert.deepEqual(writes, [['engine-report.json', report]], 'No host-result artifact may be manufactured at the observation deadline');
  });
});

test('live CLI settlement budget refuses zero, over-cap, fractional, unsafe, and nonnumeric values before any observation', async () => {
  await withPreflightGuards(async () => {
    const { collectLiveHostEvidenceV1 } = await load();
    let calls = 0;
    const host = { async settled() { calls++; return {}; } }, retain = async () => { calls++; };
    for (const settlementTimeoutMs of [0, -0, -1, 30001, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1', null]) {
      await assert.rejects(collectLiveHostEvidenceV1(host, {}, retain, { settlementTimeoutMs }), { code: 'LIVE_DEMO_SETTLEMENT_BUDGET' });
    }
    assert.equal(calls, 0, 'An invalid observation budget must not start host settlement or report retention');
  });
});
