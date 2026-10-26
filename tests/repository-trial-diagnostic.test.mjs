import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeRepositoryTrialDiagnosticV1 as encode, decodeRepositoryTrialDiagnosticV1 as decode, readRepositoryTrialDiagnosticV1 as read } from '../history/repository-trial-diagnostic-v1.mjs';
import { diagnosticFixture } from './helpers/repository-trial-diagnostic-fixture.mjs';
test('diagnostic codec roundtrip is exact bounded frozen and non-authorizing', () => {
  const input = diagnosticFixture(), encoded = encode(input), decoded = decode(encoded.bytes);
  assert.deepEqual(decoded.data, encoded.data); assert.equal(decoded.sha256, encoded.sha256);
  assert(Object.isFrozen(decoded.data.lane)); input.binding.requestId = 'b'.repeat(64); assert.notEqual(encoded.data.binding.requestId, input.binding.requestId);
  assert.equal(decoded.data.projection.modelCalls, null); assert.equal(decoded.data.rawEvidenceRetained, false);
});
test('diagnostic strict schema refuses extra raw fields false authority and incompatible states', () => {
  for (const change of [x => { x.raw = 'PRIVATE_SECRET'; }, x => { x.authorizing = true; },
    x => { x.kind = 'TERMINAL_CHANNELS'; }, x => { x.channels.hostRun.code = 'PRIVATE_SECRET'; },
    x => { x.channels.hostRun.state = 'REJECTED'; }, x => { x.binding.model = 'raw served model'; },
    x => { x.projection.inputTokens = 0; }, x => { x.projection.state = 'PUBLISHED'; },
    x => { x.lane.pendingTransports = -0; }, x => { x.host.outcome = 'PRIVATE_SECRET'; },
    x => { x.host.runId = 'bad'; }, x => { x.binding.requestId += '\n'; }]) {
    const input = diagnosticFixture(); change(input); assert.throws(() => read(input));
  }
});
test('diagnostic input never invokes getters or serializes arbitrary rejected error text', () => {
  const input = diagnosticFixture(); let calls = 0;
  Object.defineProperty(input.host, 'outcome', { enumerable: true, get() { calls++; return 'PRIVATE_SECRET'; } });
  assert.throws(() => read(input)); assert.equal(calls, 0);
  const hostile = diagnosticFixture(); Object.defineProperty(hostile.host.settlementFailures, '0', { get() { calls++; return true; } });
  assert.throws(() => read(hostile)); assert.equal(calls, 0);
});
test('diagnostic decoder rejects corruption noncanonical data duplicate keys and oversize bytes', () => {
  const encoded = encode(diagnosticFixture());
  for (const bytes of [Buffer.concat([encoded.bytes, Buffer.from('\n')]), Buffer.from(encoded.bytes.toString().replace('"sha256":', '"extra":true,"sha256":')),
    Buffer.from(encoded.bytes.toString().replace('"authorizing":false', '"authorizing":false,"authorizing":false')),
    Buffer.from(encoded.bytes.toString().replace(encoded.sha256, '0'.repeat(64))), Buffer.from([255]), Buffer.alloc(65537), Buffer.from('{}')])
    assert.throws(() => decode(bytes));
});
